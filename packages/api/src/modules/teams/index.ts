/**
 * Squads (issue #78, PRD §12, RF-15). Porta de `apps/web/mocks/handlers/teams.ts`: mesmas rotas, mensagens
 * e códigos; regras puras compartilhadas em `@nova/schemas` (`inviteState`, `validateLogoDataUrl`…).
 *
 * - Convites por apelido (uso único), link ou código de 6 caracteres, válidos por 72 h.
 * - **Lacuna:** tentativas de código têm limite por IP (6 caracteres são adivinháveis por força bruta).
 * - Excluir o squad arquiva: o histórico de inscrições guarda nome e tag; a tag fica livre de novo.
 * - Quem está escalado numa inscrição ativa não sai do squad. A trava de elenco por data (só o organizador
 *   substitui) vale na inscrição (#79) e na substituição durante o campeonato (#100).
 */
import type { Prisma, PrismaClient } from '@nova/db';
import {
  AcceptTeamInviteResult,
  ACTIVE_REGISTRATION_STATUSES,
  ENDED_TOURNAMENT_STATUSES,
  InviteCandidate,
  inviteExpiry,
  inviteState,
  inviteStateMessage,
  MAX_TEAM_MEMBERS,
  normalizeInviteCode,
  Team,
  TeamInput,
  TeamInvite,
  TeamInviteInput,
  TeamInvitePreview,
  TeamUpdateInput,
  TransferCaptainInput,
  UpdateMemberInput,
  validateLogoDataUrl,
} from '@nova/schemas';
import { Hono } from 'hono';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { body, respond, type AppContext, type AppEnv } from '../../context';
import { badRequest, conflict, forbidden, HttpProblem, notFound } from '../../errors';
import { currentSession, requireSession } from '../../auth/session';
import { clientIp, enforceLimit, type RateRule } from '../../security';
import { messages } from '../../messages/pt-BR';
import { notify } from '../../notify';
import { joinOpenRosters } from '../registrations/roster';

/** Convites pendentes por squad: evita que um capitão gere códigos sem parar. */
const MAX_PENDING_INVITES = 20;
/** Tentativas de código por IP: cobre quem digita errado, barra força bruta (32⁶ combinações). */
const INVITE_CODE_RULE: RateRule = { name: 'team-invite-code', tokens: 20, windowSeconds: 60 };
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

type Db = PrismaClient | Prisma.TransactionClient;
const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

const teamInclude = {
  members: { include: { user: { select: { nickname: true, avatarUrl: true } } }, orderBy: { joinedAt: 'asc' } },
  invites: { where: { status: 'PENDING' }, orderBy: { createdAt: 'desc' } },
} satisfies Prisma.TeamInclude;
type TeamRow = Prisma.TeamGetPayload<{ include: typeof teamInclude }>;
type InviteRow = { id: string; teamId: string; invitedUserId: string | null; code: string; status: TeamInvite['status']; expiresAt: Date; createdById: string; createdAt: Date };

async function nicknames(db: Db, ids: (string | null)[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  const users = list.length ? await db.user.findMany({ where: { id: { in: list } }, select: { id: true, nickname: true } }) : [];
  return new Map(users.map((u) => [u.id, u.nickname]));
}

async function toInvites(db: Db, invites: InviteRow[], team: { name: string; tag: string }): Promise<TeamInvite[]> {
  const nick = await nicknames(db, invites.flatMap((i) => [i.invitedUserId, i.createdById]));
  return invites.map((i) => ({
    id: i.id,
    teamId: i.teamId,
    teamName: team.name,
    teamTag: team.tag,
    invitedUserId: i.invitedUserId,
    invitedNickname: i.invitedUserId ? (nick.get(i.invitedUserId) ?? null) : null,
    code: i.code,
    status: i.status === 'PENDING' && i.expiresAt <= new Date() ? 'EXPIRED' : i.status,
    invitedByNickname: nick.get(i.createdById) ?? '',
    expiresAt: i.expiresAt.toISOString(),
    createdAt: i.createdAt.toISOString(),
  }));
}

/** Convites pendentes só aparecem para o capitão: o código dá acesso ao squad. */
async function toTeam(db: Db, t: TeamRow, viewerId: string | null): Promise<Team> {
  const pending = viewerId === t.captainId ? t.invites.filter((i) => i.expiresAt > new Date()) : [];
  return {
    id: t.id,
    name: t.name,
    tag: t.tag,
    logoUrl: t.logoUrl,
    captainId: t.captainId,
    members: t.members.map((m) => ({ userId: m.userId, nickname: m.user.nickname, avatarUrl: m.user.avatarUrl, role: m.role, isSub: m.isSub, joinedAt: m.joinedAt.toISOString() })),
    pendingInvites: await toInvites(db, pending, t),
    createdAt: t.createdAt.toISOString(),
  };
}

async function findTeam(db: Db, id: string): Promise<TeamRow> {
  const team = isUuid(id) ? await db.team.findUnique({ where: { id }, include: teamInclude }) : null;
  // Squad excluído (arquivado) some do site.
  if (!team || team.archivedAt) throw notFound('Squad');
  return team;
}

async function requireCaptain(c: AppContext, team: TeamRow): Promise<string> {
  const session = await requireSession(c);
  if (team.captainId !== session.userId) throw forbidden('Só o capitão do squad pode fazer isso.');
  return session.userId;
}

const isMember = (team: TeamRow, userId: string) => team.members.some((m) => m.userId === userId);

async function assertTagFree(db: Db, tag: string, exceptTeamId?: string): Promise<void> {
  const taken = await db.team.findFirst({ where: { tag: { equals: tag, mode: 'insensitive' }, ...(exceptTeamId ? { id: { not: exceptTeamId } } : {}) }, select: { id: true } });
  if (taken) throw new HttpProblem(409, 'Já existe um squad com esta tag.', 'TAG_TAKEN', { tag: 'Já existe um squad com esta tag. Escolha outra.' });
}

function assertLogo(logoUrl: string | null | undefined): void {
  if (!logoUrl) return;
  // Logo enviado pelo armazenamento (#73) é um endereço do Blob; o recorte antigo do protótipo é data URL.
  if (logoUrl.startsWith('https://')) return;
  const problem = validateLogoDataUrl(logoUrl);
  if (problem) throw badRequest(problem, 'INVALID_LOGO', { logoUrl: problem });
}

/** Inscrições do squad que ainda valem, em campeonatos que não acabaram (com os membros escalados). */
async function activeRegistrations(db: Db, teamId: string) {
  return db.registration.findMany({
    where: { teamId, status: { in: ACTIVE_REGISTRATION_STATUSES }, tournament: { status: { notIn: ENDED_TOURNAMENT_STATUSES } } },
    select: { tournament: { select: { name: true } }, members: { select: { userId: true } } },
  });
}

const isUniqueViolation = (error: unknown) => error instanceof Error && 'code' in error && (error as { code?: string }).code === 'P2002';

async function newCode(db: Db): Promise<string> {
  for (let i = 0; i < 50; i += 1) {
    let code = '';
    for (let j = 0; j < 6; j += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!(await db.teamInvite.findUnique({ where: { code }, select: { id: true } }))) return code;
  }
  throw new HttpProblem(500, 'Não foi possível gerar o código do convite. Tente de novo.');
}

/** Acha o convite pelo código, com limite de tentativas por IP (proteção contra força bruta). */
async function findInviteByCode(c: AppContext, raw: string): Promise<InviteRow> {
  const { limiter, now, db } = c.get('deps');
  await enforceLimit(limiter(c.get('env')), INVITE_CODE_RULE, clientIp(c.req.raw.headers), now()).catch((error: unknown) => {
    if (error instanceof HttpProblem && error.status === 429) {
      const problem = new HttpProblem(429, 'Muitas tentativas de código. Espere um minuto e confira o código com o capitão.', 'TOO_MANY_ATTEMPTS');
      problem.retryAfter = error.retryAfter;
      throw problem;
    }
    throw error;
  });
  const invite = await db().teamInvite.findUnique({ where: { code: normalizeInviteCode(raw) } });
  if (!invite) throw new HttpProblem(404, 'Não achamos nenhum convite com este código. Confira se digitou certo.', 'INVITE_NOT_FOUND');
  return invite;
}

function assertUsable(invite: InviteRow): void {
  const state = inviteState({ status: invite.status, expiresAt: invite.expiresAt.toISOString() });
  const message = inviteStateMessage(state);
  if (message) throw new HttpProblem(410, message, `INVITE_${state}`);
}

export const teams = new Hono<AppEnv>();

// ── Squads ───────────────────────────────────────────────────────────
teams.get('/teams/mine', async (c) => {
  const session = await requireSession(c);
  const db = c.get('deps').db();
  const rows = await db.team.findMany({ where: { archivedAt: null, members: { some: { userId: session.userId } } }, include: teamInclude });
  rows.sort((a, b) => Number(b.captainId === session.userId) - Number(a.captainId === session.userId) || a.name.localeCompare(b.name, 'pt-BR'));
  return respond(c, z.array(Team), await Promise.all(rows.map((t) => toTeam(db, t, session.userId))));
});

teams.post('/teams', async (c) => {
  const session = await requireSession(c);
  const input = await body(c, TeamInput);
  const db = c.get('deps').db();
  await assertTagFree(db, input.tag);
  assertLogo(input.logoUrl);
  try {
    const team = await db.team.create({
      data: { name: input.name.trim(), tag: input.tag.toUpperCase(), logoUrl: input.logoUrl ?? null, captainId: session.userId, members: { create: { userId: session.userId, role: 'CAPTAIN' } } },
      include: teamInclude,
    });
    return respond(c, Team, await toTeam(db, team, session.userId), 201);
  } catch (error) {
    if (isUniqueViolation(error)) throw new HttpProblem(409, 'Já existe um squad com esta tag.', 'TAG_TAKEN', { tag: 'Já existe um squad com esta tag. Escolha outra.' });
    throw error;
  }
});

teams.get('/teams/:id', async (c) => {
  const db = c.get('deps').db();
  const team = await findTeam(db, c.req.param('id'));
  return respond(c, Team, await toTeam(db, team, (await currentSession(c))?.userId ?? null));
});

teams.patch('/teams/:id', async (c) => {
  const db = c.get('deps').db();
  const team = await findTeam(db, c.req.param('id'));
  const userId = await requireCaptain(c, team);
  const input = await body(c, TeamUpdateInput);
  if (input.tag !== undefined) await assertTagFree(db, input.tag, team.id);
  assertLogo(input.logoUrl);
  const updated = await db.team.update({
    where: { id: team.id },
    data: { ...(input.name !== undefined ? { name: input.name.trim() } : {}), ...(input.tag !== undefined ? { tag: input.tag.toUpperCase() } : {}), ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}) },
    include: teamInclude,
  });
  return respond(c, Team, await toTeam(db, updated, userId));
});

teams.delete('/teams/:id', async (c) => {
  const db = c.get('deps').db();
  const team = await findTeam(db, c.req.param('id'));
  await requireCaptain(c, team);
  const [active] = await activeRegistrations(db, team.id);
  if (active) throw conflict(`O squad está inscrito em ${active.tournament.name}. Cancele a inscrição antes de excluir o squad.`, 'TEAM_HAS_ACTIVE_REGISTRATION');
  await db.$transaction(async (tx) => {
    // O histórico continua mostrando o nome do squad: as inscrições antigas guardam nome e tag.
    await tx.registration.updateMany({ where: { teamId: team.id, displayName: null }, data: { displayName: team.name, tag: team.tag } });
    await tx.teamInvite.updateMany({ where: { teamId: team.id, status: 'PENDING' }, data: { status: 'REVOKED' } });
    // Arquivado: some do site e libera a tag para outro squad.
    await tx.team.update({ where: { id: team.id }, data: { archivedAt: c.get('deps').now(), tag: `~${team.id}` } });
  });
  return c.body(null, 204);
});

// ── Membros ──────────────────────────────────────────────────────────
teams.patch('/teams/:id/members/:userId', async (c) => {
  const db = c.get('deps').db();
  const team = await findTeam(db, c.req.param('id'));
  const userId = await requireCaptain(c, team);
  const input = await body(c, UpdateMemberInput);
  const target = c.req.param('userId');
  if (!isMember(team, target)) throw notFound('Membro');
  await db.teamMember.update({ where: { teamId_userId: { teamId: team.id, userId: target } }, data: { isSub: input.isSub } });
  return respond(c, Team, await toTeam(db, await findTeam(db, team.id), userId));
});

teams.delete('/teams/:id/members/:userId', async (c) => {
  const db = c.get('deps').db();
  const team = await findTeam(db, c.req.param('id'));
  const session = await requireSession(c);
  const targetId = c.req.param('userId');
  const leaving = targetId === session.userId;
  if (!leaving && team.captainId !== session.userId) throw forbidden('Só o capitão pode remover membros do squad.');
  const target = team.members.find((m) => m.userId === targetId);
  if (!target) throw notFound('Membro');
  if (targetId === team.captainId) {
    throw conflict(team.members.length > 1 ? 'Transfira a capitania para outro membro antes de sair do squad.' : 'Você é o único membro. Para sair, exclua o squad.', 'CAPTAIN_MUST_TRANSFER');
  }
  // Quem está escalado numa inscrição ativa não sai do squad: o elenco do campeonato ficaria errado.
  const escalated = (await activeRegistrations(db, team.id)).find((r) => r.members.some((m) => m.userId === targetId));
  if (escalated) {
    const who = leaving ? 'Você está escalado' : `${target.user.nickname} está escalado`;
    throw conflict(`${who} na inscrição do squad em ${escalated.tournament.name}. Só dá para sair depois que essa inscrição for cancelada ou o campeonato terminar.`, 'MEMBER_IN_ACTIVE_REGISTRATION');
  }
  await db.teamMember.delete({ where: { teamId_userId: { teamId: team.id, userId: targetId } } });
  return c.body(null, 204);
});

teams.post('/teams/:id/transfer-captain', async (c) => {
  const db = c.get('deps').db();
  const team = await findTeam(db, c.req.param('id'));
  const userId = await requireCaptain(c, team);
  const input = await body(c, TransferCaptainInput);
  if (input.userId === userId) throw conflict('Você já é o capitão deste squad.');
  if (!isMember(team, input.userId)) throw badRequest('Escolha um membro do squad para ser o novo capitão.', 'NOT_A_MEMBER', { userId: 'Escolha um membro do squad.' });
  await db.$transaction([
    db.teamMember.updateMany({ where: { teamId: team.id }, data: { role: 'MEMBER' } }),
    db.teamMember.update({ where: { teamId_userId: { teamId: team.id, userId: input.userId } }, data: { role: 'CAPTAIN' } }),
    db.team.update({ where: { id: team.id }, data: { captainId: input.userId } }),
  ]);
  // Quem deixou de ser capitão não vê mais os convites pendentes.
  return respond(c, Team, await toTeam(db, await findTeam(db, team.id), userId));
});

// ── Convites ─────────────────────────────────────────────────────────
teams.post('/teams/:id/invites', async (c) => {
  const db = c.get('deps').db();
  const team = await findTeam(db, c.req.param('id'));
  const userId = await requireCaptain(c, team);
  const input = await body(c, TeamInviteInput);
  const now = c.get('deps').now();
  if (team.members.length >= MAX_TEAM_MEMBERS) throw conflict(`O squad já tem ${MAX_TEAM_MEMBERS} jogadores, o máximo permitido.`, 'TEAM_FULL');
  const pending = team.invites.filter((i) => i.expiresAt > now);
  if (pending.length >= MAX_PENDING_INVITES) throw conflict('Este squad já tem muitos convites pendentes. Cancele algum antes de criar outro.', 'TOO_MANY_INVITES');

  let invitedUserId: string | null = null;
  if (input.kind === 'nickname') {
    const target = await db.user.findUnique({ where: { nicknameKey: input.nickname.trim().replace(/^@/, '').toLowerCase() } });
    if (!target || target.status !== 'ACTIVE') throw new HttpProblem(404, 'Não achamos nenhum jogador com este apelido.', 'USER_NOT_FOUND', { nickname: 'Não achamos nenhum jogador com este apelido.' });
    if (isMember(team, target.id)) throw new HttpProblem(409, `${target.nickname} já faz parte do squad.`, 'ALREADY_MEMBER', { nickname: `${target.nickname} já faz parte do squad.` });
    if (pending.some((i) => i.invitedUserId === target.id)) {
      throw new HttpProblem(409, `${target.nickname} já tem um convite pendente deste squad.`, 'ALREADY_INVITED', { nickname: `${target.nickname} já tem um convite pendente deste squad.` });
    }
    invitedUserId = target.id;
  }
  const invite = await db.teamInvite.create({ data: { teamId: team.id, invitedUserId, code: await newCode(db), createdById: userId, expiresAt: new Date(inviteExpiry(now)) } });
  const [view] = await toInvites(db, [invite], team);
  if (invitedUserId) {
    const captain = team.members.find((m) => m.userId === userId)?.user.nickname ?? 'O capitão';
    await notify(c, [invitedUserId], { type: 'TEAM_INVITE', title: messages.teams.invite.title(team.name), body: messages.teams.invite.body(captain), link: `/squads/convite/${invite.code}` });
  }
  return respond(c, TeamInvite, view as TeamInvite, 201);
});

/** Convites pendentes dirigidos a mim (feitos por apelido). */
teams.get('/me/team-invites', async (c) => {
  const session = await requireSession(c);
  const db = c.get('deps').db();
  const rows = await db.teamInvite.findMany({ where: { invitedUserId: session.userId, status: 'PENDING', expiresAt: { gt: c.get('deps').now() }, team: { archivedAt: null } }, include: { team: { select: { name: true, tag: true } } }, orderBy: { createdAt: 'desc' } });
  const views = await Promise.all(rows.map(async (r) => (await toInvites(db, [r], r.team))[0] as TeamInvite));
  return respond(c, z.array(TeamInvite), views);
});

/** Revogar: o parâmetro é o id do convite (não o código), e só o capitão do squad pode. */
teams.delete('/team-invites/:id', async (c) => {
  const db = c.get('deps').db();
  const id = c.req.param('id');
  const invite = isUuid(id) ? await db.teamInvite.findUnique({ where: { id } }) : null;
  if (!invite) throw notFound('Convite');
  await requireCaptain(c, await findTeam(db, invite.teamId));
  if (invite.status === 'PENDING') await db.teamInvite.update({ where: { id }, data: { status: 'REVOKED' } });
  return c.body(null, 204);
});

/** Prévia pública: quem recebe o link vê o squad antes de entrar na conta. */
teams.get('/team-invites/:code', async (c) => {
  const db = c.get('deps').db();
  const invite = await findInviteByCode(c, c.req.param('code'));
  const team = await findTeam(db, invite.teamId);
  const viewer = (await currentSession(c))?.userId ?? null;
  const nick = await nicknames(db, [invite.createdById, invite.invitedUserId]);
  return respond(c, TeamInvitePreview, {
    code: invite.code,
    state: inviteState({ status: invite.status, expiresAt: invite.expiresAt.toISOString() }),
    team: { id: team.id, name: team.name, tag: team.tag, logoUrl: team.logoUrl, memberCount: team.members.length },
    invitedByNickname: nick.get(invite.createdById) ?? '',
    invitedNickname: invite.invitedUserId ? (nick.get(invite.invitedUserId) ?? null) : null,
    expiresAt: invite.expiresAt.toISOString(),
    viewerIsMember: viewer !== null && isMember(team, viewer),
    viewerIsNotInvitee: viewer !== null && invite.invitedUserId !== null && invite.invitedUserId !== viewer,
  });
});

teams.post('/team-invites/:code/accept', async (c) => {
  const session = await requireSession(c);
  const db = c.get('deps').db();
  const invite = await findInviteByCode(c, c.req.param('code'));
  const team = await findTeam(db, invite.teamId);
  if (isMember(team, session.userId)) throw conflict(`Você já faz parte do ${team.name}.`, 'ALREADY_MEMBER');
  assertUsable(invite);
  if (invite.invitedUserId !== null && invite.invitedUserId !== session.userId) {
    throw new HttpProblem(403, 'Este convite foi enviado para outro jogador. Peça ao capitão um convite para o seu apelido ou um link.', 'INVITE_NOT_FOR_YOU');
  }
  if (team.members.length >= MAX_TEAM_MEMBERS) throw conflict(`O ${team.name} já está cheio (${MAX_TEAM_MEMBERS} jogadores).`, 'TEAM_FULL');
  try {
    await db.$transaction([
      db.teamMember.create({ data: { teamId: team.id, userId: session.userId } }),
      // Convite por apelido é de uso único. O link/código continua valendo até expirar ou ser revogado,
      // para o capitão mandar um link só no grupo do time.
      db.teamInvite.updateMany({ where: { teamId: team.id, invitedUserId: session.userId, status: 'PENDING' }, data: { status: 'ACCEPTED' } }),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict(`Você já faz parte do ${team.name}.`, 'ALREADY_MEMBER');
    throw error;
  }
  // Um passo só: o squad que espera jogadores num campeonato já ganha o novo membro no elenco.
  const rosters = await joinOpenRosters(c, session.userId, team.id);
  const me = await db.user.findUnique({ where: { id: session.userId }, select: { nickname: true } });
  await notify(c, [team.captainId], { type: 'TEAM_INVITE', title: messages.teams.joined.title(team.name), body: messages.teams.joined.body(me?.nickname ?? 'Um jogador'), link: `/minha-conta/squads/${team.id}` });
  return respond(c, AcceptTeamInviteResult, { ...(await toTeam(db, await findTeam(db, team.id), session.userId)), rosters });
});

teams.post('/team-invites/:code/decline', async (c) => {
  const session = await requireSession(c);
  const db = c.get('deps').db();
  const invite = await findInviteByCode(c, c.req.param('code'));
  if (invite.invitedUserId !== session.userId) throw forbidden('Só dá para recusar um convite feito para você.');
  assertUsable(invite);
  await db.teamInvite.update({ where: { id: invite.id }, data: { status: 'DECLINED' } });
  return c.body(null, 204);
});

// ── Busca de jogador para convidar ───────────────────────────────────
teams.get('/user-search', async (c) => {
  const session = await requireSession(c);
  const q = (c.req.query('q') ?? '').trim().toLowerCase();
  if (q.length < 2) throw badRequest('Digite pelo menos 2 caracteres para buscar.', 'VALIDATION', { q: 'Digite pelo menos 2 caracteres.' });
  const rows = await c.get('deps').db().user.findMany({ where: { status: 'ACTIVE', id: { not: session.userId }, nicknameKey: { contains: q } }, select: { id: true, nickname: true, avatarUrl: true }, take: 50 });
  // Quem começa com o texto vem primeiro; depois, ordem alfabética. Só o que é público.
  rows.sort((a, b) => Number(b.nickname.toLowerCase().startsWith(q)) - Number(a.nickname.toLowerCase().startsWith(q)) || a.nickname.localeCompare(b.nickname, 'pt-BR'));
  return respond(c, z.array(InviteCandidate), rows.slice(0, 8));
});
