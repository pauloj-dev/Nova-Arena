/**
 * Módulo `discord` da API simulada: vínculo do bot do Discord (issue 121). Mesmas rotas e regras da API real
 * (`packages/api/src/modules/discord`), com o servidor do Discord **simulado**:
 *
 * - No protótipo o bot conta como configurado (`enabled: true`), sem endereço de instalação (`installUrl: null`).
 * - `POST /discord/interactions` não confere assinatura Ed25519 (não há Discord aqui): quem "chama o comando" é a pessoa
 *   logada no protótipo, como se a conta do Discord dela estivesse vinculada. A tela usa isso no botão "Simular o
 *   comando no protótipo", que só aparece com o módulo simulado.
 * - Avisos de teste não saem para lugar nenhum: só marcam o "último aviso".
 */
import { http, type HttpHandler } from 'msw';
import {
  DISCORD_LINK_CODE_TTL_MINUTES,
  DiscordInteraction,
  type DiscordInteractionResponse,
  type DiscordLinkCode,
  type DiscordLinkStatus,
  type Match,
} from '@nova/schemas';
import { publish } from '../bus';
import { checkInRequired, getMeta, listMatches, registrationOfUser, splitMatchId } from '../competition';
import { collection, db, nowIso, save, uid } from '../db';
import { conflict, currentUser, findTournament, handle, HttpProblem, json, param, requireTournamentAccess, tournamentAccess, url } from '../http';

export const moduleName = 'discord';

export interface DbDiscordLink {
  id: string;
  tournamentId: string;
  /** No protótipo o código fica em claro (não há banco de verdade); na API real, só o SHA-256. */
  code: string | null;
  codeExpiresAt: string | null;
  guildId: string | null;
  guildName: string | null;
  channelId: string | null;
  linkedById: string | null;
  linkedAt: string | null;
  lastAnnouncementAt: string | null;
  lastError: string | null;
}

export const discordLinks = () => collection<DbDiscordLink>('discordLinks');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => {
  const part = () => Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
  return `NA-${part()}-${part()}`;
};
const normalize = (code: string) => code.trim().toUpperCase().replace(/\s+/g, '');
const CLOSED = new Set<Match['status']>(['VALIDATED', 'WALKOVER', 'CANCELLED']);

function statusOf(tournamentId: string): DiscordLinkStatus {
  const link = discordLinks().find((l) => l.tournamentId === tournamentId);
  const pending = Boolean(link?.code && link.codeExpiresAt && link.codeExpiresAt > nowIso());
  const active = Boolean(link?.linkedAt && link.channelId);
  const linkedBy = link?.linkedById ? db().users.find((u) => u.id === link.linkedById) : undefined;
  return {
    enabled: true,
    installUrl: null,
    state: active ? 'ACTIVE' : pending ? 'PENDING' : 'NONE',
    codeExpiresAt: pending ? (link?.codeExpiresAt ?? null) : null,
    guildId: active ? (link?.guildId ?? null) : null,
    guildName: active ? (link?.guildName ?? null) : null,
    channelId: active ? (link?.channelId ?? null) : null,
    linkedAt: active ? (link?.linkedAt ?? null) : null,
    linkedByNickname: active ? (linkedBy?.nickname ?? null) : null,
    lastAnnouncementAt: active ? (link?.lastAnnouncementAt ?? null) : null,
    lastError: active ? (link?.lastError ?? null) : null,
  };
}

/** Organização que gerencia (dono, co-organizador ou Admin): o moderador não vincula. */
function requireManager(idOrSlug: string) {
  const t = findTournament(idOrSlug);
  requireTournamentAccess(t);
  return t;
}

const reply = (content: string, ephemeral = true): DiscordInteractionResponse => ({ type: 4, data: { content, ...(ephemeral ? { flags: 64 } : {}), allowed_mentions: { parse: [] } } });
const unix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

function upcomingOf(userId: string) {
  const out: { match: Match; tournament: { id: string; name: string; slug: string } }[] = [];
  for (const t of db().tournaments.filter((x) => x.status === 'IN_PROGRESS' || x.status === 'PAUSED')) {
    const reg = registrationOfUser(t.id, userId);
    if (!reg || reg.status !== 'CONFIRMED') continue;
    for (const m of listMatches(t.id)) {
      if (!CLOSED.has(m.status) && !m.waitingPrevious && m.participants.some((p) => p.registrationId === reg.id)) out.push({ match: m, tournament: { id: t.id, name: t.name, slug: t.slug } });
    }
  }
  return out.sort((a, b) => (a.match.scheduledAt ?? '9999').localeCompare(b.match.scheduledAt ?? '9999'));
}

const label = (m: Match) => (m.kind === 'LOBBY' ? [m.stageName, m.groupName, m.roundLabel].filter(Boolean).join(' · ') : `${m.roundLabel}: ${m.participants.map((p) => p.name || p.sourceLabel || 'A definir').join(' x ')}`);

export const handlers: HttpHandler[] = [
  http.post(
    url('/discord/interactions'),
    handle(async ({ request }) => {
      const parsed = DiscordInteraction.safeParse(await request.json().catch(() => null));
      if (!parsed.success) throw new HttpProblem(400, 'Interação inválida.', 'INVALID_BODY');
      const i = parsed.data;
      if (i.type === 1) return json({ type: 1 });
      const user = currentUser();
      if (!user) return json(reply('Sua conta do Discord ainda não está ligada a uma conta da Nova Arena. Entre em /minha-conta/seguranca e use **Vincular Discord**; depois é só repetir o comando.'));
      const sub = i.data?.options?.[0];
      if (sub?.name === 'vincular') {
        if (!i.guild_id || !i.channel_id || !i.member) return json(reply('Use este comando dentro do canal do servidor que vai receber os avisos.'));
        if (!/^\d+$/.test(i.member.permissions ?? '') || (BigInt(i.member.permissions as string) & 0x20n) !== 0x20n) return json(reply('Só quem pode **Gerenciar servidor** no Discord vincula o servidor a um campeonato.'));
        const code = normalize(String(sub.options?.find((o) => o.name === 'codigo')?.value ?? ''));
        const link = discordLinks().find((l) => l.code === code && l.codeExpiresAt && l.codeExpiresAt > nowIso());
        if (!link) return json(reply('Código inválido ou vencido. Gere um novo na aba **Discord** da operação do campeonato.'));
        const t = db().tournaments.find((x) => x.id === link.tournamentId);
        const access = t ? tournamentAccess(user, t) : null;
        if (!t || !access || access === 'MODERATOR') return json(reply(`Só a organização de **${t?.name ?? 'o campeonato'}** pode vincular o campeonato. Confira se você entrou no Discord com a conta certa.`));
        Object.assign(link, { guildId: i.guild_id, guildName: i.guild?.name ?? null, channelId: i.channel_id, linkedById: user.id, linkedAt: nowIso(), code: null, codeExpiresAt: null, lastError: null });
        save();
        return json(reply(`✅ Este canal agora recebe os avisos de **${t.name}**: partida em 15 minutos, resultados, chave e campeão. Jogadores podem usar \`/nova-arena checkin\` e \`/nova-arena proxima\`.`, false));
      }
      if (sub?.name === 'proxima') {
        const [next] = upcomingOf(user.id);
        if (!next) return json(reply('Você não tem partida por jogar nos campeonatos em andamento.'));
        const when = next.match.scheduledAt ? `<t:${unix(next.match.scheduledAt)}:F> (<t:${unix(next.match.scheduledAt)}:R>)` : 'horário ainda não definido pela organização';
        return json(reply(`🎮 Sua próxima partida: **${label(next.match)}** em **${next.tournament.name}**\n${when}`));
      }
      if (sub?.name === 'checkin') {
        const now = Date.now();
        const open = upcomingOf(user.id).find((u) => u.match.checkInOpensAt && u.match.checkInClosesAt && now >= Date.parse(u.match.checkInOpensAt) && now < Date.parse(u.match.checkInClosesAt));
        if (!open) return json(reply('Você não tem check-in aberto agora.'));
        // Mesma regra de `POST /matches/:id/check-in`: no squad, o capitão (ou todos os titulares, se exigido).
        const t = db().tournaments.find((x) => x.id === open.tournament.id);
        const reg = t ? registrationOfUser(t.id, user.id) : null;
        if (!t || !reg || !checkInRequired(t, reg).includes(user.id)) return json(reply('Neste campeonato, quem faz o check-in do squad é o capitão (ou cada titular, se a organização pediu).'));
        const meta = getMeta(open.match.id);
        if (!meta.checkIns.some((c) => c.registrationId === reg.id && c.userId === user.id)) {
          meta.checkIns.push({ registrationId: reg.id, userId: user.id, at: nowIso() });
          meta.updatedAt = nowIso();
          save();
        }
        publish(`tournament:${t.id}`, { type: 'match.updated', matchId: open.match.id, stageId: splitMatchId(open.match.id).stageId, status: open.match.status });
        return json(reply(`✅ Check-in feito em **${label(open.match)}** (${open.tournament.name}).`));
      }
      return json(reply('Comando desconhecido. Use `/nova-arena proxima`, `/nova-arena checkin` ou `/nova-arena vincular`.'));
    }),
  ),

  http.get(
    url('/tournaments/:id/discord'),
    handle(({ params }) => json(statusOf(requireManager(param(params, 'id')).id))),
  ),

  http.post(
    url('/tournaments/:id/discord/code'),
    handle(({ params }) => {
      const t = requireManager(param(params, 'id'));
      const code = newCode();
      const expiresAt = new Date(Date.now() + DISCORD_LINK_CODE_TTL_MINUTES * 60_000).toISOString();
      const existing = discordLinks().find((l) => l.tournamentId === t.id);
      if (existing) Object.assign(existing, { code, codeExpiresAt: expiresAt });
      else discordLinks().push({ id: uid('dl'), tournamentId: t.id, code, codeExpiresAt: expiresAt, guildId: null, guildName: null, channelId: null, linkedById: null, linkedAt: null, lastAnnouncementAt: null, lastError: null });
      save();
      const result: DiscordLinkCode = { code, expiresAt, command: `/nova-arena vincular codigo:${code}` };
      return json(result, 201);
    }),
  ),

  http.delete(
    url('/tournaments/:id/discord'),
    handle(({ params }) => {
      const t = requireManager(param(params, 'id'));
      const list = discordLinks();
      const index = list.findIndex((l) => l.tournamentId === t.id);
      if (index >= 0) {
        list.splice(index, 1);
        save();
      }
      return json(statusOf(t.id));
    }),
  ),

  http.post(
    url('/tournaments/:id/discord/test'),
    handle(({ params }) => {
      const t = requireManager(param(params, 'id'));
      const link = discordLinks().find((l) => l.tournamentId === t.id);
      if (!link?.linkedAt) throw conflict('Vincule um servidor do Discord antes de enviar o aviso de teste.', 'DISCORD_NOT_LINKED');
      link.lastAnnouncementAt = nowIso();
      save();
      return json({ queued: true }, 202);
    }),
  ),
];
