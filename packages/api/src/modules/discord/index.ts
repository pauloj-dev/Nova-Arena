/**
 * Bot do Discord (issue 121). Porta de `apps/web/mocks/handlers/discord.ts` (que simula o servidor do Discord no
 * protótipo).
 *
 * Organização do campeonato (dono, co-organizador ou Admin — o moderador não vincula):
 * - `GET /tournaments/:id/discord`: estado do vínculo e o endereço para adicionar o bot.
 * - `POST /tournaments/:id/discord/code`: gera o código de uso único (15 min). Só o hash fica no banco; o código aparece
 *   uma vez. Gerar de novo troca o vínculo pendente (o ativo continua até o novo código ser usado).
 * - `DELETE /tournaments/:id/discord`: desvincula.
 * - `POST /tournaments/:id/discord/test`: aviso de teste no canal (pela fila).
 *
 * Discord (webhook HTTP, sem processo contínuo):
 * - `POST /discord/interactions`: assinatura Ed25519 conferida antes de tudo (401 se inválida). Comandos
 *   `/nova-arena vincular codigo:`, `/nova-arena checkin` e `/nova-arena proxima`. Quem chama é identificado pela conta
 *   do Discord vinculada à conta Nova Arena (login com Discord, `oauth_accounts`).
 *
 * Jobs do QStash (assinados): `/jobs/discord/announce` (resultado, chave, campeão, teste) e `/jobs/discord/reminder`
 * (partida em 15 min). Canal sem permissão ou apagado: registra o problema no vínculo e não tenta de novo; limite de
 * taxa ou falha do Discord: 500, e o QStash tenta de novo.
 */
import { audited, withAudit, type PrismaClient } from '@nova/db';
import {
  ACTIVE_REGISTRATION_STATUSES,
  DISCORD_LINK_CODE_TTL_MINUTES,
  DiscordInteraction,
  DiscordInteractionResponse,
  DiscordLinkCode,
  DiscordLinkStatus,
  DiscordQueued,
  type Match,
} from '@nova/schemas';
import { Hono } from 'hono';
import { z } from 'zod';
import { respond, type AppContext, type AppEnv } from '../../context';
import { badRequest, HttpProblem } from '../../errors';
import { assertTournamentAccess, tournamentAccessDecision } from '../../auth/rbac';
import { listMatches } from '../../competition/bracket';
import { requiredUsers, rosterSelect } from '../../competition/check-in';
import {
  announceDiscord,
  discordConfigured,
  discordEscape,
  discordInstallUrl,
  discordTime,
  hashLinkCode,
  hasManageGuild,
  newLinkCode,
  postChannelMessage,
  REMINDER_MINUTES,
  scheduleDiscordReminder,
  siteUrlOf,
  verifyDiscordSignature,
} from '../../discord';
import { requireQStash } from '../../jobs';
import { isCurrentSchedule } from '../../jobs/matches';
import { runJob } from '../../jobs/runner';
import { auditCtx } from '../competition/access';

const CLOSED_MATCH = new Set<Match['status']>(['VALIDATED', 'WALKOVER', 'CANCELLED']);
const RUNNING = ['IN_PROGRESS', 'PAUSED'] as const;
/** Mensagem só para quem chamou o comando. */
const EPHEMERAL = 64;

// ── Estado do vínculo ────────────────────────────────────────────────
async function linkStatus(c: AppContext, tournamentId: string): Promise<DiscordLinkStatus> {
  const env = c.get('env');
  const db = c.get('deps').db();
  const link = await db.discordLink.findUnique({ where: { tournamentId } });
  const now = c.get('deps').now();
  const pending = Boolean(link?.codeHash && link.codeExpiresAt && link.codeExpiresAt > now);
  const active = Boolean(link?.linkedAt && link.channelId);
  const linkedBy = link?.linkedById ? await db.user.findUnique({ where: { id: link.linkedById }, select: { nickname: true } }) : null;
  return {
    enabled: discordConfigured(env),
    installUrl: discordInstallUrl(env),
    // Ativo continua ativo enquanto um código novo não é usado.
    state: active ? 'ACTIVE' : pending ? 'PENDING' : 'NONE',
    codeExpiresAt: pending ? (link?.codeExpiresAt?.toISOString() ?? null) : null,
    guildId: active ? (link?.guildId ?? null) : null,
    guildName: active ? (link?.guildName ?? null) : null,
    channelId: active ? (link?.channelId ?? null) : null,
    linkedAt: active ? (link?.linkedAt?.toISOString() ?? null) : null,
    linkedByNickname: active ? (linkedBy?.nickname ?? null) : null,
    lastAnnouncementAt: active ? (link?.lastAnnouncementAt?.toISOString() ?? null) : null,
    lastError: active ? (link?.lastError ?? null) : null,
  };
}

function requireBot(c: AppContext): void {
  if (!discordConfigured(c.get('env'))) throw new HttpProblem(503, 'O bot do Discord não está configurado neste ambiente.', 'DISCORD_DISABLED');
}

// ── Próximas partidas de alguém ──────────────────────────────────────
export interface UpcomingMatch {
  match: Match;
  registrationId: string;
  tournament: { id: string; name: string; slug: string; checkInConfig: unknown };
}

/** Partidas ainda por jogar das inscrições ativas da pessoa, em campeonatos em andamento (horário mais próximo antes). */
export async function upcomingMatchesOf(db: PrismaClient, userId: string, tournamentIds?: string[]): Promise<UpcomingMatch[]> {
  const regs = await db.registration.findMany({
    where: {
      status: { in: [...ACTIVE_REGISTRATION_STATUSES] },
      OR: [{ userId }, { members: { some: { userId, confirmedAt: { not: null } } } }],
      tournament: { status: { in: [...RUNNING] }, ...(tournamentIds ? { id: { in: tournamentIds } } : {}) },
    },
    select: { id: true, tournament: { select: { id: true, name: true, slug: true, checkInConfig: true } } },
  });
  const out: UpcomingMatch[] = [];
  for (const reg of regs) {
    for (const match of await listMatches(db, reg.tournament.id)) {
      if (CLOSED_MATCH.has(match.status) || match.waitingPrevious) continue;
      if (match.participants.some((p) => p.registrationId === reg.id)) out.push({ match, registrationId: reg.id, tournament: reg.tournament });
    }
  }
  return out.sort((a, b) => (a.match.scheduledAt ?? '9999').localeCompare(b.match.scheduledAt ?? '9999'));
}

function matchLabel(m: Match): string {
  if (m.kind === 'LOBBY') return [m.stageName, m.groupName, m.roundLabel].filter(Boolean).join(' · ');
  return `${m.roundLabel}: ${m.participants.map((p) => discordEscape(p.name || p.sourceLabel || 'A definir')).join(' x ')}`;
}

// ── Interações ───────────────────────────────────────────────────────
type Reply = { content: string; ephemeral?: boolean };

const reply = (r: Reply): DiscordInteractionResponse => ({ type: 4, data: { content: r.content.slice(0, 2000), flags: r.ephemeral === false ? undefined : EPHEMERAL, allowed_mentions: { parse: [] } } });

async function novaUserOf(db: PrismaClient, discordUserId: string): Promise<{ id: string; nickname: string } | null> {
  const account = await db.oAuthAccount.findUnique({ where: { provider_providerAccountId: { provider: 'discord', providerAccountId: discordUserId } }, select: { user: { select: { id: true, nickname: true, status: true } } } });
  return account && account.user.status === 'ACTIVE' ? { id: account.user.id, nickname: account.user.nickname } : null;
}

const linkAccountText = (site: string) => `Sua conta do Discord ainda não está ligada a uma conta da Nova Arena. Entre em ${site}/minha-conta/seguranca e use **Vincular Discord**; depois é só repetir o comando.`;

/** Campeonatos ligados a este servidor (no servidor); em mensagem direta, todos os da pessoa. */
async function scopeOf(db: PrismaClient, guildId: string | undefined): Promise<string[] | undefined> {
  if (!guildId) return undefined;
  const links = await db.discordLink.findMany({ where: { guildId, linkedAt: { not: null } }, select: { tournamentId: true } });
  return links.length > 0 ? links.map((l) => l.tournamentId) : undefined;
}

async function commandLink(c: AppContext, i: DiscordInteraction, code: string): Promise<Reply> {
  const db = c.get('deps').db();
  const site = siteUrlOf(c);
  if (!i.guild_id || !i.channel_id || !i.member) return { content: 'Use este comando dentro do canal do servidor que vai receber os avisos.' };
  if (!hasManageGuild(i.member.permissions)) return { content: 'Só quem pode **Gerenciar servidor** no Discord vincula o servidor a um campeonato.' };
  const user = await novaUserOf(db, i.member.user.id);
  if (!user) return { content: linkAccountText(site) };
  const now = c.get('deps').now();
  const link = await db.discordLink.findUnique({ where: { codeHash: hashLinkCode(code) }, include: { tournament: { select: { id: true, name: true, slug: true, ownerId: true, staff: { where: { userId: user.id }, select: { role: true } } } } } });
  if (!link || !link.codeExpiresAt || link.codeExpiresAt <= now) return { content: 'Código inválido ou vencido. Gere um novo na aba **Discord** da operação do campeonato.' };
  const roles = (await db.userRole.findMany({ where: { userId: user.id }, select: { role: true } })).map((r) => r.role);
  const t = link.tournament;
  if (!tournamentAccessDecision({ userId: user.id, roles, ownerId: t.ownerId, staffRole: t.staff[0]?.role ?? null, level: 'manage' })) {
    return { content: `Só a organização de **${discordEscape(t.name)}** pode vincular o campeonato. Confira se você entrou no Discord com a conta certa.` };
  }
  const updated = await db.discordLink.updateMany({
    where: { id: link.id, codeHash: link.codeHash },
    data: { guildId: i.guild_id, guildName: i.guild?.name ?? null, channelId: i.channel_id, linkedById: user.id, linkedAt: now, codeHash: null, codeExpiresAt: null, lastError: null },
  });
  if (updated.count === 0) return { content: 'Este código acabou de ser usado. Gere um novo, se precisar.' };
  await withAudit(db, { actorId: user.id, ip: null, userAgent: 'Discord' }, async (tx) => {
    await audited(tx, { action: 'TOURNAMENT_UPDATED', entityType: 'Tournament', entityId: t.id, entityLabel: t.name, tournamentId: t.id, after: { discord: 'servidor vinculado', canal: i.channel_id } });
  }).catch((error: unknown) => c.get('log').warn('não foi possível auditar o vínculo do Discord', { error: String(error) }));
  // Lembretes das partidas já agendadas.
  for (const m of await listMatches(db, t.id)) {
    if (m.scheduledAt && !CLOSED_MATCH.has(m.status)) await scheduleDiscordReminder(c, { id: m.id, scheduledAt: new Date(m.scheduledAt) }, t.id);
  }
  return { ephemeral: false, content: `✅ Este canal agora recebe os avisos de **${discordEscape(t.name)}**: partida em ${REMINDER_MINUTES} minutos, resultados, chave e campeão. Jogadores podem usar \`/nova-arena checkin\` e \`/nova-arena proxima\`.\n${site}/c/${t.slug}` };
}

async function commandNext(c: AppContext, i: DiscordInteraction): Promise<Reply> {
  const db = c.get('deps').db();
  const site = siteUrlOf(c);
  const discordUser = i.member?.user ?? i.user;
  if (!discordUser) return { content: 'Não consegui identificar quem chamou o comando.' };
  const user = await novaUserOf(db, discordUser.id);
  if (!user) return { content: linkAccountText(site) };
  const [next] = await upcomingMatchesOf(db, user.id, await scopeOf(db, i.guild_id));
  if (!next) return { content: 'Você não tem partida por jogar nos campeonatos em andamento.' };
  const m = next.match;
  const when = m.scheduledAt ? `${discordTime(new Date(m.scheduledAt), 'F')} (${discordTime(new Date(m.scheduledAt), 'R')})` : 'horário ainda não definido pela organização';
  const checkIn = m.checkInOpensAt && m.checkInClosesAt ? `\nCheck-in: de ${discordTime(new Date(m.checkInOpensAt), 't')} a ${discordTime(new Date(m.checkInClosesAt), 't')} — use \`/nova-arena checkin\`.` : '';
  return { content: `🎮 Sua próxima partida: **${matchLabel(m)}** em **${discordEscape(next.tournament.name)}**\n${when}${checkIn}\n${site}/c/${next.tournament.slug}?aba=partidas` };
}

async function commandCheckIn(c: AppContext, i: DiscordInteraction): Promise<Reply> {
  const db = c.get('deps').db();
  const site = siteUrlOf(c);
  const discordUser = i.member?.user ?? i.user;
  if (!discordUser) return { content: 'Não consegui identificar quem chamou o comando.' };
  const user = await novaUserOf(db, discordUser.id);
  if (!user) return { content: linkAccountText(site) };
  const now = c.get('deps').now().getTime();
  const upcoming = await upcomingMatchesOf(db, user.id, await scopeOf(db, i.guild_id));
  const open = upcoming.find((u) => u.match.checkInOpensAt && u.match.checkInClosesAt && now >= Date.parse(u.match.checkInOpensAt) && now < Date.parse(u.match.checkInClosesAt));
  if (!open) {
    const soon = upcoming.find((u) => u.match.checkInOpensAt && now < Date.parse(u.match.checkInOpensAt));
    return { content: soon?.match.checkInOpensAt ? `O check-in da sua próxima partida (**${matchLabel(soon.match)}**) abre ${discordTime(new Date(soon.match.checkInOpensAt), 'R')}.` : 'Você não tem check-in aberto agora.' };
  }
  const reg = await db.registration.findUniqueOrThrow({ where: { id: open.registrationId }, select: rosterSelect });
  if (!requiredUsers(reg, open.tournament.checkInConfig).includes(user.id)) return { content: 'Neste campeonato, quem faz o check-in do squad é o capitão (ou cada titular, se a organização pediu).' };
  await db.checkIn.upsert({
    where: { matchId_registrationId_userId: { matchId: open.match.id, registrationId: open.registrationId, userId: user.id } },
    create: { matchId: open.match.id, registrationId: open.registrationId, userId: user.id },
    update: {},
  });
  const at = open.match.scheduledAt ? ` A partida começa ${discordTime(new Date(open.match.scheduledAt), 'R')}.` : '';
  return { content: `✅ Check-in feito em **${matchLabel(open.match)}** (${discordEscape(open.tournament.name)}).${at} A sala aparece em ${site}/c/${open.tournament.slug}?aba=partidas` };
}

export const discord = new Hono<AppEnv>();

discord.post('/discord/interactions', async (c) => {
  const env = c.get('env');
  // Desligado: o Discord nem deveria chamar; responde como assinatura inválida, sem revelar nada.
  if (!discordConfigured(env)) throw new HttpProblem(401, 'Assinatura inválida.', 'DISCORD_SIGNATURE');
  const raw = await c.req.text();
  if (!verifyDiscordSignature(env.DISCORD_PUBLIC_KEY as string, c.req.header('x-signature-ed25519'), c.req.header('x-signature-timestamp'), raw)) {
    throw new HttpProblem(401, 'Assinatura inválida.', 'DISCORD_SIGNATURE');
  }
  let parsed: DiscordInteraction;
  try {
    parsed = DiscordInteraction.parse(JSON.parse(raw));
  } catch {
    throw badRequest('Interação inválida.', 'INVALID_BODY');
  }
  if (parsed.type === 1) return respond(c, DiscordInteractionResponse, { type: 1 });
  if (parsed.type !== 2 || parsed.data?.name !== 'nova-arena') return respond(c, DiscordInteractionResponse, reply({ content: 'Comando desconhecido.' }));
  const sub = parsed.data.options?.[0];
  try {
    if (sub?.name === 'vincular') {
      const code = String(sub.options?.find((o) => o.name === 'codigo')?.value ?? '');
      return respond(c, DiscordInteractionResponse, reply(await commandLink(c, parsed, code)));
    }
    if (sub?.name === 'checkin') return respond(c, DiscordInteractionResponse, reply(await commandCheckIn(c, parsed)));
    if (sub?.name === 'proxima') return respond(c, DiscordInteractionResponse, reply(await commandNext(c, parsed)));
    return respond(c, DiscordInteractionResponse, reply({ content: 'Comando desconhecido. Use `/nova-arena proxima`, `/nova-arena checkin` ou `/nova-arena vincular`.' }));
  } catch (error) {
    // O Discord mostra "a aplicação não respondeu" se a resposta não for 200: melhor uma mensagem clara.
    c.get('log').error('falha num comando do Discord', { command: sub?.name ?? null, error: error instanceof Error ? error.message : String(error) });
    return respond(c, DiscordInteractionResponse, reply({ content: 'Algo deu errado do nosso lado. Tente de novo em instantes.' }));
  }
});

// ── Organização ──────────────────────────────────────────────────────
discord.get('/tournaments/:id/discord', async (c) => {
  const access = await assertTournamentAccess(c, c.req.param('id'), 'manage');
  c.header('Cache-Control', 'private, no-store');
  return respond(c, DiscordLinkStatus, await linkStatus(c, access.tournamentId));
});

discord.post('/tournaments/:id/discord/code', async (c) => {
  const access = await assertTournamentAccess(c, c.req.param('id'), 'manage');
  requireBot(c);
  const db = c.get('deps').db();
  const now = c.get('deps').now();
  const code = newLinkCode();
  const expiresAt = new Date(now.getTime() + DISCORD_LINK_CODE_TTL_MINUTES * 60_000);
  const actor = await auditCtx(c);
  await db.discordLink.upsert({
    where: { tournamentId: access.tournamentId },
    create: { tournamentId: access.tournamentId, codeHash: hashLinkCode(code), codeExpiresAt: expiresAt, createdById: actor.actorId },
    update: { codeHash: hashLinkCode(code), codeExpiresAt: expiresAt, createdById: actor.actorId },
  });
  c.header('Cache-Control', 'private, no-store');
  return respond(c, DiscordLinkCode, { code, expiresAt: expiresAt.toISOString(), command: `/nova-arena vincular codigo:${code}` }, 201);
});

discord.delete('/tournaments/:id/discord', async (c) => {
  const access = await assertTournamentAccess(c, c.req.param('id'), 'manage');
  const db = c.get('deps').db();
  const link = await db.discordLink.findUnique({ where: { tournamentId: access.tournamentId }, include: { tournament: { select: { name: true } } } });
  if (link) {
    await withAudit(db, await auditCtx(c), async (tx) => {
      await tx.discordLink.delete({ where: { id: link.id } });
      if (link.linkedAt) await audited(tx, { action: 'TOURNAMENT_UPDATED', entityType: 'Tournament', entityId: access.tournamentId, entityLabel: link.tournament.name, tournamentId: access.tournamentId, before: { discord: 'servidor vinculado' }, after: { discord: 'desvinculado' } });
    });
  }
  return respond(c, DiscordLinkStatus, await linkStatus(c, access.tournamentId));
});

discord.post('/tournaments/:id/discord/test', async (c) => {
  const access = await assertTournamentAccess(c, c.req.param('id'), 'manage');
  requireBot(c);
  const db = c.get('deps').db();
  const link = await db.discordLink.findUnique({ where: { tournamentId: access.tournamentId }, include: { tournament: { select: { name: true, slug: true } } } });
  if (!link?.linkedAt || !link.channelId) throw new HttpProblem(409, 'Vincule um servidor do Discord antes de enviar o aviso de teste.', 'DISCORD_NOT_LINKED');
  const now = c.get('deps').now();
  await announceDiscord(c, access.tournamentId, 'TEST', `🔔 Aviso de teste da Nova Arena: este canal está recebendo os avisos de **${discordEscape(link.tournament.name)}**.\n${siteUrlOf(c)}/c/${link.tournament.slug}`, `${access.tournamentId}-${now.getTime()}`);
  return respond(c, DiscordQueued, { queued: true }, 202);
});

// ── Jobs ─────────────────────────────────────────────────────────────
const AnnounceJob = z.object({ tournamentId: z.uuid(), kind: z.string(), content: z.string().min(1).max(2000) });
const ReminderJob = z.object({ matchId: z.uuid(), scheduledAt: z.iso.datetime({ offset: true }) });

/** Entrega no canal; erro definitivo (sem permissão, canal apagado) fica no vínculo e não volta para a fila. */
async function deliver(c: AppContext, tournamentId: string, content: string, job: string): Promise<{ delivered: boolean; reason?: string }> {
  const db = c.get('deps').db();
  const link = await db.discordLink.findUnique({ where: { tournamentId } });
  if (!link?.linkedAt || !link.channelId) return { delivered: false, reason: 'not-linked' };
  const env = c.get('env');
  if (!discordConfigured(env)) return { delivered: false, reason: 'disabled' };
  const result = await runJob(c, job, 'qstash', async () => {
    const r = await postChannelMessage(env, link.channelId as string, content);
    if (r.status === 429 || r.status >= 500) throw new Error(`Discord respondeu ${r.status}`);
    return r;
  });
  const now = c.get('deps').now();
  if (result.ok) {
    await db.discordLink.update({ where: { id: link.id }, data: { lastAnnouncementAt: now, lastError: null } });
    return { delivered: true };
  }
  const message = result.status === 403 ? 'O bot não tem permissão para escrever no canal vinculado.' : result.status === 404 ? 'O canal vinculado não existe mais.' : `O Discord recusou o aviso (HTTP ${result.status}).`;
  await db.discordLink.update({ where: { id: link.id }, data: { lastError: message } });
  c.get('log').warn('aviso do Discord recusado', { tournamentId, status: result.status });
  return { delivered: false, reason: `http-${result.status}` };
}

discord.post('/jobs/discord/announce', requireQStash, async (c) => {
  const parsed = AnnounceJob.safeParse(c.get('jobBody'));
  if (!parsed.success) throw badRequest('Corpo do job inválido.', 'INVALID_BODY');
  return c.json({ ok: true, ...(await deliver(c, parsed.data.tournamentId, parsed.data.content, 'jobs/discord/announce')) });
});

discord.post('/jobs/discord/reminder', requireQStash, async (c) => {
  const parsed = ReminderJob.safeParse(c.get('jobBody'));
  if (!parsed.success) throw badRequest('Corpo do job inválido.', 'INVALID_BODY');
  const db = c.get('deps').db();
  const row = await db.match.findUnique({ where: { id: parsed.data.matchId }, select: { scheduledAt: true, stage: { select: { tournamentId: true, tournament: { select: { name: true, slug: true, status: true } } } } } });
  // Reagendada ou apagada: a mensagem velha não faz nada.
  if (!row || !isCurrentSchedule(row, parsed.data)) return c.json({ ok: true, stale: true });
  const t = row.stage.tournament;
  const match = (await listMatches(db, row.stage.tournamentId)).find((m) => m.id === parsed.data.matchId);
  if (!match || CLOSED_MATCH.has(match.status) || !(RUNNING as readonly string[]).includes(t.status)) return c.json({ ok: true, stale: false, skipped: true });
  const at = new Date(parsed.data.scheduledAt);
  const checkIn = match.checkInClosesAt ? ` Check-in até ${discordTime(new Date(match.checkInClosesAt), 't')}: \`/nova-arena checkin\`.` : '';
  const content = `⏰ **Partida em ${REMINDER_MINUTES} minutos** — ${matchLabel(match)} · ${discordEscape(t.name)}\nComeça ${discordTime(at, 't')}.${checkIn}\n${siteUrlOf(c)}/c/${t.slug}?aba=partidas`;
  return c.json({ ok: true, stale: false, ...(await deliver(c, row.stage.tournamentId, content, 'jobs/discord/reminder')) });
});
