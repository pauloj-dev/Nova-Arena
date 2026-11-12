/**
 * Módulo `teams` da API simulada: squads, membros, convites e busca de jogador para convidar (PRD §12).
 * As regras puras ficam em `features/teams/lib/rules.ts`.
 */
import { http } from 'msw';
import {
  ACTIVE_REGISTRATION_STATUSES,
  MAX_TEAM_MEMBERS,
  TeamInput,
  TeamInviteInput,
  TeamUpdateInput,
  TransferCaptainInput,
  UpdateMemberInput,
  type InviteCandidate,
  type Team,
  type TeamInvitePreview,
} from '@nova/schemas';
import { ENDED_TOURNAMENT_STATUSES } from '@/features/registrations/lib/rules';
import { AttemptLimiter, inviteExpiry, inviteState, inviteStateMessage, normalizeInviteCode, validateLogoDataUrl } from '@/features/teams/lib/rules';
import { db, getSessionUserId, inviteCode, nowIso, save, uid, type DbTeam, type DbTeamInvite, type DbUser } from '../db';
import { badRequest, body, conflict, currentUser, forbidden, handle, HttpProblem, json, noContent, notFound, param, query, requireUser, url } from '../http';
import { findUser, toTeam, toTeamInvite } from '../views';

export const moduleName = 'teams';

/** Convites pendentes por squad: evita que um capitão gere códigos sem parar. */
const MAX_PENDING_INVITES = 20;

const attempts = new AttemptLimiter();

function findTeam(id: string): DbTeam {
  const team = db().teams.find((t) => t.id === id);
  if (!team) throw notFound('Squad');
  return team;
}
function requireCaptain(team: DbTeam): DbUser {
  const user = requireUser();
  if (team.captainId !== user.id) throw forbidden('Só o capitão do squad pode fazer isso.');
  return user;
}
function isMember(team: DbTeam, userId: string): boolean {
  return team.members.some((m) => m.userId === userId);
}
/** Convites pendentes só aparecem para o capitão: o código dá acesso ao squad. */
function teamView(team: DbTeam, viewer: DbUser | null): Team {
  const view = toTeam(team);
  return viewer?.id === team.captainId ? view : { ...view, pendingInvites: [] };
}

function assertTagFree(tag: string, exceptTeamId?: string): void {
  const taken = db().teams.some((t) => t.id !== exceptTeamId && t.tag.toLowerCase() === tag.toLowerCase());
  if (taken) throw new HttpProblem(409, 'Já existe um squad com esta tag.', 'TAG_TAKEN', { tag: 'Já existe um squad com esta tag. Escolha outra.' });
}
function assertLogo(logoUrl: string | null | undefined): void {
  if (!logoUrl) return;
  const problem = validateLogoDataUrl(logoUrl);
  if (problem) throw badRequest(problem, 'INVALID_LOGO', { logoUrl: problem });
}

/** Inscrições do squad que ainda valem, em campeonatos que não acabaram. */
function activeRegistrations(teamId: string) {
  const d = db();
  return d.registrations.filter((r) => {
    if (r.teamId !== teamId || !ACTIVE_REGISTRATION_STATUSES.includes(r.status)) return false;
    const tournament = d.tournaments.find((t) => t.id === r.tournamentId);
    return tournament !== undefined && !ENDED_TOURNAMENT_STATUSES.includes(tournament.status);
  });
}
function tournamentName(id: string): string {
  return db().tournaments.find((t) => t.id === id)?.name ?? 'um campeonato';
}

// ── Convites ─────────────────────────────────────────────────────────
function newCode(): string {
  const d = db();
  for (let i = 0; i < 50; i += 1) {
    const code = inviteCode();
    if (!d.teamInvites.some((x) => x.code === code)) return code;
  }
  throw new HttpProblem(500, 'Não foi possível gerar o código do convite. Tente de novo.');
}

/** Chave do limite de tentativas. No protótipo não há IP: vale a conta (ou "visitante"). */
function attemptKey(): string {
  return getSessionUserId() ?? 'visitante';
}
function tooManyAttempts(): HttpProblem {
  const seconds = attempts.retryAfterSeconds(attemptKey());
  return new HttpProblem(429, `Muitas tentativas com código errado. Espere ${seconds} s e confira o código com o capitão.`, 'TOO_MANY_ATTEMPTS');
}
/** Acha o convite pelo código, contando as tentativas erradas (proteção contra força bruta). */
function findInviteByCode(raw: string): DbTeamInvite {
  const key = attemptKey();
  if (attempts.isBlocked(key)) throw tooManyAttempts();
  const code = normalizeInviteCode(raw);
  const invite = db().teamInvites.find((i) => i.code === code);
  if (!invite) {
    attempts.fail(key);
    throw new HttpProblem(404, 'Não achamos nenhum convite com este código. Confira se digitou certo.', 'INVITE_NOT_FOUND');
  }
  return invite;
}
function assertUsable(invite: DbTeamInvite): void {
  const state = inviteState(invite);
  const message = inviteStateMessage(state);
  if (message) throw new HttpProblem(410, message, `INVITE_${state}`);
}
function toPreview(invite: DbTeamInvite, viewer: DbUser | null): TeamInvitePreview {
  const team = findTeam(invite.teamId);
  return {
    code: invite.code,
    state: inviteState(invite),
    team: { id: team.id, name: team.name, tag: team.tag, logoUrl: team.logoUrl, memberCount: team.members.length },
    invitedByNickname: findUser(invite.invitedById)?.nickname ?? '',
    invitedNickname: findUser(invite.invitedUserId)?.nickname ?? null,
    expiresAt: invite.expiresAt,
    viewerIsMember: viewer !== null && isMember(team, viewer.id),
    viewerIsNotInvitee: viewer !== null && invite.invitedUserId !== null && invite.invitedUserId !== viewer.id,
  };
}

export const handlers = [
  // ── Squads ─────────────────────────────────────────────────────────
  http.get(
    url('/teams/mine'),
    handle(() => {
      const user = requireUser();
      const list = db()
        .teams.filter((t) => isMember(t, user.id))
        .sort((a, b) => Number(b.captainId === user.id) - Number(a.captainId === user.id) || a.name.localeCompare(b.name, 'pt-BR'))
        .map((t) => teamView(t, user));
      return json(list);
    }),
  ),

  http.post(
    url('/teams'),
    handle(async ({ request }) => {
      const user = requireUser();
      const input = await body(request, TeamInput);
      assertTagFree(input.tag);
      assertLogo(input.logoUrl);
      const now = nowIso();
      const team: DbTeam = {
        id: uid('t'),
        name: input.name.trim(),
        tag: input.tag.toUpperCase(),
        logoUrl: input.logoUrl ?? null,
        captainId: user.id,
        members: [{ userId: user.id, role: 'CAPTAIN', isSub: false, joinedAt: now }],
        createdAt: now,
      };
      db().teams.push(team);
      save();
      return json(teamView(team, user), 201);
    }),
  ),

  http.get(
    url('/teams/:id'),
    handle(({ params }) => {
      const team = findTeam(param(params, 'id'));
      return json(teamView(team, currentUser()));
    }),
  ),

  http.patch(
    url('/teams/:id'),
    handle(async ({ params, request }) => {
      const team = findTeam(param(params, 'id'));
      const user = requireCaptain(team);
      const input = await body(request, TeamUpdateInput);
      if (input.tag !== undefined) assertTagFree(input.tag, team.id);
      assertLogo(input.logoUrl);
      if (input.name !== undefined) team.name = input.name.trim();
      if (input.tag !== undefined) team.tag = input.tag.toUpperCase();
      if (input.logoUrl !== undefined) team.logoUrl = input.logoUrl;
      save();
      return json(teamView(team, user));
    }),
  ),

  http.delete(
    url('/teams/:id'),
    handle(({ params }) => {
      const team = findTeam(param(params, 'id'));
      requireCaptain(team);
      const active = activeRegistrations(team.id)[0];
      if (active) {
        throw conflict(`O squad está inscrito em ${tournamentName(active.tournamentId)}. Cancele a inscrição antes de excluir o squad.`, 'TEAM_HAS_ACTIVE_REGISTRATION');
      }
      const d = db();
      // O histórico continua mostrando o nome do squad: as inscrições antigas guardam nome e tag.
      for (const r of d.registrations) {
        if (r.teamId !== team.id) continue;
        r.importedName = r.importedName ?? team.name;
        r.importedTag = r.importedTag ?? team.tag;
      }
      for (const i of d.teamInvites) {
        if (i.teamId === team.id && i.status === 'PENDING') i.status = 'REVOKED';
      }
      d.teams = d.teams.filter((t) => t.id !== team.id);
      save();
      return noContent();
    }),
  ),

  // ── Membros ────────────────────────────────────────────────────────
  http.patch(
    url('/teams/:id/members/:userId'),
    handle(async ({ params, request }) => {
      const team = findTeam(param(params, 'id'));
      const user = requireCaptain(team);
      const input = await body(request, UpdateMemberInput);
      const member = team.members.find((m) => m.userId === param(params, 'userId'));
      if (!member) throw notFound('Membro');
      member.isSub = input.isSub;
      save();
      return json(teamView(team, user));
    }),
  ),

  http.delete(
    url('/teams/:id/members/:userId'),
    handle(({ params }) => {
      const team = findTeam(param(params, 'id'));
      const user = requireUser();
      const targetId = param(params, 'userId');
      const leaving = targetId === user.id;
      if (!leaving && team.captainId !== user.id) throw forbidden('Só o capitão pode remover membros do squad.');
      if (!isMember(team, targetId)) throw notFound('Membro');
      if (targetId === team.captainId) {
        throw conflict(
          team.members.length > 1 ? 'Transfira a capitania para outro membro antes de sair do squad.' : 'Você é o único membro. Para sair, exclua o squad.',
          'CAPTAIN_MUST_TRANSFER',
        );
      }
      // Quem está escalado numa inscrição ativa não sai do squad: o elenco do campeonato ficaria errado.
      const escalated = activeRegistrations(team.id).find((r) => r.members.some((m) => m.userId === targetId));
      if (escalated) {
        const who = leaving ? 'Você está escalado' : `${findUser(targetId)?.nickname ?? 'Este jogador'} está escalado`;
        throw conflict(`${who} na inscrição do squad em ${tournamentName(escalated.tournamentId)}. Só dá para sair depois que essa inscrição for cancelada ou o campeonato terminar.`, 'MEMBER_IN_ACTIVE_REGISTRATION');
      }
      team.members = team.members.filter((m) => m.userId !== targetId);
      save();
      return noContent();
    }),
  ),

  http.post(
    url('/teams/:id/transfer-captain'),
    handle(async ({ params, request }) => {
      const team = findTeam(param(params, 'id'));
      const user = requireCaptain(team);
      const input = await body(request, TransferCaptainInput);
      if (input.userId === user.id) throw conflict('Você já é o capitão deste squad.');
      const next = team.members.find((m) => m.userId === input.userId);
      if (!next) throw badRequest('Escolha um membro do squad para ser o novo capitão.', 'NOT_A_MEMBER', { userId: 'Escolha um membro do squad.' });
      for (const m of team.members) m.role = m.userId === next.userId ? 'CAPTAIN' : 'MEMBER';
      team.captainId = next.userId;
      save();
      // Quem deixou de ser capitão não vê mais os convites pendentes.
      return json(teamView(team, user));
    }),
  ),

  // ── Convites ───────────────────────────────────────────────────────
  http.post(
    url('/teams/:id/invites'),
    handle(async ({ params, request }) => {
      const team = findTeam(param(params, 'id'));
      const user = requireCaptain(team);
      const input = await body(request, TeamInviteInput);
      const d = db();
      if (team.members.length >= MAX_TEAM_MEMBERS) throw conflict(`O squad já tem ${MAX_TEAM_MEMBERS} jogadores, o máximo permitido.`, 'TEAM_FULL');
      const pending = d.teamInvites.filter((i) => i.teamId === team.id && inviteState(i) === 'VALID');
      if (pending.length >= MAX_PENDING_INVITES) throw conflict('Este squad já tem muitos convites pendentes. Cancele algum antes de criar outro.', 'TOO_MANY_INVITES');

      let invitedUserId: string | null = null;
      if (input.kind === 'nickname') {
        const nickname = input.nickname.trim().toLowerCase();
        const target = d.users.find((u) => u.nickname.toLowerCase() === nickname && u.status === 'ACTIVE');
        if (!target) throw new HttpProblem(404, 'Não achamos nenhum jogador com este apelido.', 'USER_NOT_FOUND', { nickname: 'Não achamos nenhum jogador com este apelido.' });
        if (isMember(team, target.id)) throw new HttpProblem(409, `${target.nickname} já faz parte do squad.`, 'ALREADY_MEMBER', { nickname: `${target.nickname} já faz parte do squad.` });
        if (pending.some((i) => i.invitedUserId === target.id)) {
          throw new HttpProblem(409, `${target.nickname} já tem um convite pendente deste squad.`, 'ALREADY_INVITED', { nickname: `${target.nickname} já tem um convite pendente deste squad.` });
        }
        invitedUserId = target.id;
      }

      const invite: DbTeamInvite = { id: uid('ti'), teamId: team.id, invitedUserId, code: newCode(), status: 'PENDING', invitedById: user.id, expiresAt: inviteExpiry(), createdAt: nowIso() };
      d.teamInvites.push(invite);
      save();
      return json(toTeamInvite(invite), 201);
    }),
  ),

  /** Convites pendentes dirigidos a mim (feitos por apelido). */
  http.get(
    url('/me/team-invites'),
    handle(() => {
      const user = requireUser();
      const list = db()
        .teamInvites.filter((i) => i.invitedUserId === user.id && inviteState(i) === 'VALID')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(toTeamInvite);
      return json(list);
    }),
  ),

  /** Revogar: o parâmetro é o id do convite (não o código), e só o capitão do squad pode. */
  http.delete(
    url('/team-invites/:id'),
    handle(({ params }) => {
      const invite = db().teamInvites.find((i) => i.id === param(params, 'id'));
      if (!invite) throw notFound('Convite');
      requireCaptain(findTeam(invite.teamId));
      if (invite.status === 'PENDING') {
        invite.status = 'REVOKED';
        save();
      }
      return noContent();
    }),
  ),

  /** Prévia pública: quem recebe o link vê o squad antes de entrar na conta. */
  http.get(
    url('/team-invites/:code'),
    handle(({ params }) => {
      const invite = findInviteByCode(param(params, 'code'));
      return json(toPreview(invite, currentUser()));
    }),
  ),

  http.post(
    url('/team-invites/:code/accept'),
    handle(({ params }) => {
      const user = requireUser();
      const invite = findInviteByCode(param(params, 'code'));
      const team = findTeam(invite.teamId);
      if (isMember(team, user.id)) throw conflict(`Você já faz parte do ${team.name}.`, 'ALREADY_MEMBER');
      assertUsable(invite);
      if (invite.invitedUserId !== null && invite.invitedUserId !== user.id) {
        throw new HttpProblem(403, 'Este convite foi enviado para outro jogador. Peça ao capitão um convite para o seu apelido ou um link.', 'INVITE_NOT_FOR_YOU');
      }
      if (team.members.length >= MAX_TEAM_MEMBERS) throw conflict(`O ${team.name} já está cheio (${MAX_TEAM_MEMBERS} jogadores).`, 'TEAM_FULL');

      team.members.push({ userId: user.id, role: 'MEMBER', isSub: false, joinedAt: nowIso() });
      // Convite por apelido é de uso único. O link/código continua valendo até expirar ou ser revogado,
      // para o capitão mandar um link só no grupo do time.
      for (const i of db().teamInvites) {
        if (i.teamId === team.id && i.invitedUserId === user.id && i.status === 'PENDING') i.status = 'ACCEPTED';
      }
      save();
      return json(teamView(team, user));
    }),
  ),

  http.post(
    url('/team-invites/:code/decline'),
    handle(({ params }) => {
      const user = requireUser();
      const invite = findInviteByCode(param(params, 'code'));
      if (invite.invitedUserId !== user.id) throw forbidden('Só dá para recusar um convite feito para você.');
      assertUsable(invite);
      invite.status = 'DECLINED';
      save();
      return noContent();
    }),
  ),

  // ── Busca de jogador para convidar ─────────────────────────────────
  http.get(
    url('/user-search'),
    handle(({ request }) => {
      const user = requireUser();
      const q = (query(request).get('q') ?? '').trim().toLowerCase();
      if (q.length < 2) throw badRequest('Digite pelo menos 2 caracteres para buscar.', 'VALIDATION', { q: 'Digite pelo menos 2 caracteres.' });
      const results: InviteCandidate[] = db()
        .users.filter((u) => u.status === 'ACTIVE' && u.id !== user.id && u.nickname.toLowerCase().includes(q))
        // Quem começa com o texto vem primeiro; depois, ordem alfabética.
        .sort((a, b) => Number(b.nickname.toLowerCase().startsWith(q)) - Number(a.nickname.toLowerCase().startsWith(q)) || a.nickname.localeCompare(b.nickname, 'pt-BR'))
        .slice(0, 8)
        // Só o que é público: nada de e-mail, estado ou IDs de jogo.
        .map((u) => ({ id: u.id, nickname: u.nickname, avatarUrl: u.avatarUrl }));
      return json(results);
    }),
  ),
];
