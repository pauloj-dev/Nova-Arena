/**
 * Elenco da inscrição de squad na API simulada — espelho de `packages/api/src/modules/registrations/roster.ts`:
 * escalar, tirar e remanejar (capitão até a trava de elenco; organização até o fim), entrada no elenco pelo
 * convite do squad e os avisos do fluxo de inscrição (PRD §12.1 e §12.2).
 */
import {
  ACTIVE_REGISTRATION_STATUSES,
  canCaptainEditRoster,
  canStaffEditRoster,
  rosterLimit,
  rosterNeedsPlayers,
  statusAfterRosterChange,
  type GameMode,
  type RosterJoin,
  type TournamentStatus,
} from '@nova/schemas';
import { assertEventExclusivity } from './events';
import { db, nowIso, save, type DbRegistration, type DbTournament, type DbUser } from './db';
import { conflict, HttpProblem, notFound, requireUser, tournamentAccess } from './http';
import { notify } from './notify';
import { findUser, toRegistration } from './views';

const CONFIRMATION_STATUSES: TournamentStatus[] = ['PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED'];

function modeOf(t: DbTournament): GameMode {
  const mode = db().games.find((g) => g.id === t.gameId)?.modes.find((m) => m.id === t.gameModeId);
  if (!mode) throw new HttpProblem(500, 'Campeonato sem jogo ou modo configurado.');
  return mode;
}
const confirmed = (r: DbRegistration) => r.members.filter((m) => m.confirmedAt !== null).length;
const squadName = (r: DbRegistration) => toRegistration(r).displayName;
const teamOf = (r: DbRegistration) => (r.teamId ? db().teams.find((x) => x.id === r.teamId) : undefined);

export function hasGameAccount(user: DbUser, t: DbTournament): boolean {
  const game = db().games.find((g) => g.id === t.gameId);
  if (!game || game.requiredAccountFields.length === 0) return true;
  return user.gameAccounts.some((a) => a.gameId === game.id);
}

// ── Avisos ───────────────────────────────────────────────────────────
export function notifyConfirmed(registrations: DbRegistration[]): void {
  for (const r of registrations) {
    if (r.status !== 'CONFIRMED') continue;
    const t = db().tournaments.find((x) => x.id === r.tournamentId);
    if (!t) continue;
    if (r.userId) notify([r.userId], 'REGISTRATION_CONFIRMED', 'Inscrição confirmada', `Sua vaga em ${t.name} está garantida.`, `/c/${t.slug}`);
    else if (r.members.length > 0) notify(r.members.map((m) => m.userId), 'REGISTRATION_CONFIRMED', 'Inscrição confirmada', `O ${squadName(r)} está confirmado em ${t.name}.`, `/c/${t.slug}`);
  }
}

export function notifyToConfirm(r: DbRegistration, only?: string[]): void {
  const team = teamOf(r);
  const t = db().tournaments.find((x) => x.id === r.tournamentId);
  if (!team || !t || !ACTIVE_REGISTRATION_STATUSES.includes(r.status)) return;
  const pending = r.members.filter((m) => m.confirmedAt === null && m.userId !== team.captainId && (!only || only.includes(m.userId))).map((m) => m.userId);
  notify(pending, 'TEAM_INVITE', `Confirme sua participação em ${t.name}`, `O ${team.name} se inscreveu e você está no elenco. Confirme na página do campeonato para garantir a vaga do squad.`, `/c/${t.slug}`);
}

// ── Núcleo ───────────────────────────────────────────────────────────
function assertEligible(t: DbTournament, user: DbUser): void {
  if (user.status !== 'ACTIVE') throw conflict(`${user.nickname} está com a conta suspensa, banida ou excluída e não pode jogar.`, 'USER_NOT_ACTIVE');
  if (t.ownerId === user.id || db().staff.some((s) => s.tournamentId === t.id && s.userId === user.id)) {
    throw conflict(`${user.nickname} faz parte da organização deste campeonato e não pode jogar nele.`, 'PLAYER_IS_STAFF');
  }
  // Evento com a regra "um campeonato só" (ADR-0005).
  assertEventExclusivity(t, [user.id]);
}

function addToRoster(t: DbTournament, r: DbRegistration, user: DbUser, opts: { confirmed: boolean; preferSub?: boolean }): void {
  if (!r.teamId) throw conflict('Inscrição individual não tem elenco.', 'SOLO_REGISTRATION');
  if (!ACTIVE_REGISTRATION_STATUSES.includes(r.status)) throw conflict('Esta inscrição não está mais ativa.', 'REGISTRATION_INACTIVE');
  if (r.members.some((m) => m.userId === user.id)) throw conflict(`${user.nickname} já está no elenco do ${squadName(r)}.`, 'ALREADY_IN_ROSTER');
  const mode = modeOf(t);
  const limit = rosterLimit(mode);
  if (r.members.length >= limit) throw conflict(`O elenco do ${squadName(r)} já está completo (${limit} ${limit === 1 ? 'jogador' : 'jogadores'}, contando reservas).`, 'ROSTER_FULL');
  const others = db().registrations.filter((x) => x.tournamentId === t.id && x.id !== r.id);
  // Elenco de inscrição cancelada ou recusada já foi liberado (na API real as linhas saem do banco).
  const elsewhere = others.find((x) => x.status !== 'CANCELLED' && x.status !== 'REJECTED' && x.members.some((m) => m.userId === user.id));
  if (elsewhere) throw conflict(`${user.nickname} já está no elenco do ${squadName(elsewhere)} neste campeonato. Um jogador não pode estar em dois squads no mesmo campeonato.`, 'PLAYER_IN_OTHER_TEAM');
  if (others.some((x) => x.userId === user.id && ACTIVE_REGISTRATION_STATUSES.includes(x.status))) throw conflict(`${user.nickname} já está inscrito neste campeonato.`, 'ALREADY_REGISTERED');
  assertEligible(t, user);
  const starters = r.members.filter((m) => !m.isSub).length;
  r.members.push({ userId: user.id, isSub: starters >= mode.teamSize ? true : (opts.preferSub ?? false), confirmedAt: opts.confirmed ? nowIso() : null });
}

/** Recalcula o status antes de o campeonato começar. Devolve se acabou de ficar confirmada. */
function settleRosterStatus(t: DbTournament, r: DbRegistration): boolean {
  if (!CONFIRMATION_STATUSES.includes(t.status)) return false;
  const next = statusAfterRosterChange(r.status, { manualApproval: t.manualApproval, confirmedMembers: confirmed(r), requiredMembers: modeOf(t).teamSize });
  if (next === r.status) return false;
  r.status = next;
  if (next !== 'PENDING_MEMBERS') r.reservedUntil = null;
  return next === 'CONFIRMED';
}

/** Quem entrou no squad entra no elenco das inscrições que esperam jogadores (como na API real). */
export function joinOpenRosters(user: DbUser, teamId: string): RosterJoin[] {
  const d = db();
  const joined: RosterJoin[] = [];
  for (const r of d.registrations.filter((x) => x.teamId === teamId && ACTIVE_REGISTRATION_STATUSES.includes(x.status))) {
    const t = d.tournaments.find((x) => x.id === r.tournamentId);
    if (!t || !canCaptainEditRoster({ status: t.status, rosterLockAt: t.rosterLockAt })) continue;
    if (!rosterNeedsPlayers({ members: r.members.length, confirmedMembers: confirmed(r) }, modeOf(t))) continue;
    const ok = hasGameAccount(user, t);
    try {
      addToRoster(t, r, user, { confirmed: ok });
    } catch (error) {
      if (error instanceof HttpProblem) continue;
      throw error;
    }
    const became = settleRosterStatus(t, r);
    joined.push({ registrationId: r.id, tournamentId: t.id, tournamentName: t.name, tournamentSlug: t.slug, confirmed: ok });
    if (!ok) notifyToConfirm(r, [user.id]);
    if (became) notifyConfirmed([r]);
  }
  save();
  return joined;
}

// ── Ações das rotas ──────────────────────────────────────────────────
interface Actor {
  user: DbUser;
  asCaptain: boolean;
}

export function rosterActor(r: DbRegistration, t: DbTournament): Actor {
  const user = requireUser();
  if (teamOf(r)?.captainId === user.id) return { user, asCaptain: true };
  const access = tournamentAccess(user, t);
  if (!access || access === 'MODERATOR') throw new HttpProblem(403, 'Só o capitão do squad ou a organização do campeonato mexem no elenco.', 'NOT_ROSTER_MANAGER');
  return { user, asCaptain: false };
}

export function assertCanEdit(actor: Actor, t: DbTournament): void {
  if (actor.asCaptain) {
    if (!canCaptainEditRoster({ status: t.status, rosterLockAt: t.rosterLockAt })) {
      throw conflict(
        CONFIRMATION_STATUSES.includes(t.status) ? 'A trava de elenco já passou: agora só a organização troca os membros do squad.' : 'O campeonato já começou: agora só a organização troca os membros do squad.',
        'ROSTER_LOCKED',
      );
    }
  } else if (!canStaffEditRoster(t.status)) {
    throw conflict('Este campeonato já terminou: o elenco não muda mais.', 'ROSTER_CLOSED');
  }
}

function findPlayer(input: { userId?: string | undefined; nickname?: string | undefined }): DbUser {
  const key = (input.nickname ?? '').replace(/^@/, '').trim().toLowerCase();
  const user = input.userId ? findUser(input.userId) : db().users.find((u) => u.nickname.toLowerCase() === key);
  if (!user || user.status === 'DELETED' || user.status === 'MERGED') throw new HttpProblem(404, 'Não encontramos nenhum jogador com este apelido.', 'USER_NOT_FOUND', { nickname: 'Não encontramos nenhum jogador com este apelido.' });
  return user;
}

export function addMember(actor: Actor, t: DbTournament, r: DbRegistration, input: { userId?: string | undefined; nickname?: string | undefined }): void {
  assertCanEdit(actor, t);
  const user = findPlayer(input);
  let preferSub: boolean | undefined;
  if (actor.asCaptain) {
    const member = teamOf(r)?.members.find((m) => m.userId === user.id);
    if (!member) throw new HttpProblem(400, `${user.nickname} não faz parte do squad. Convide o jogador para o squad primeiro.`, 'NOT_A_MEMBER', { userId: 'Escolha um membro do squad.' });
    preferSub = member.isSub;
  } else if (!hasGameAccount(user, t)) {
    const game = db().games.find((g) => g.id === t.gameId);
    throw conflict(`${user.nickname} ainda não informou o ID de ${game?.name ?? 'jogo'} em Minha conta. Sem ele, não dá para entrar no elenco.`, 'GAME_ACCOUNT_REQUIRED');
  }
  addToRoster(t, r, user, { confirmed: !actor.asCaptain, ...(preferSub !== undefined ? { preferSub } : {}) });
  const became = settleRosterStatus(t, r);
  save();
  if (actor.asCaptain) notifyToConfirm(r, [user.id]);
  else notify([user.id], 'TEAM_INVITE', `Você entrou no elenco do ${squadName(r)}`, `A organização escalou você em ${t.name}. Sua participação já está confirmada.`, `/c/${t.slug}`);
  if (became) notifyConfirmed([r]);
}

export function removeMember(actor: Actor, t: DbTournament, r: DbRegistration, userId: string): void {
  assertCanEdit(actor, t);
  if (!r.teamId) throw conflict('Inscrição individual não tem elenco.', 'SOLO_REGISTRATION');
  if (!r.members.some((m) => m.userId === userId)) throw notFound('Jogador no elenco');
  if (teamOf(r)?.captainId === userId) {
    throw conflict(actor.asCaptain ? 'Você é o capitão: para tirar o squad do campeonato, cancele a inscrição.' : 'Este jogador é o capitão do squad. Peça para ele passar a capitania antes de sair do elenco.', 'CAPTAIN_IN_ROSTER');
  }
  r.members = r.members.filter((m) => m.userId !== userId);
  settleRosterStatus(t, r);
  save();
  if (userId !== actor.user.id) notify([userId], 'TEAM_INVITE', `Você saiu do elenco do ${squadName(r)}`, `Você não está mais no elenco do squad em ${t.name}.`, `/c/${t.slug}`);
}

export function moveMember(actor: Actor, t: DbTournament, from: DbRegistration, to: DbRegistration, userId: string): void {
  assertCanEdit(actor, t);
  const member = from.members.find((m) => m.userId === userId);
  const user = findUser(userId);
  if (!member || !user) throw notFound('Jogador no elenco');
  if (teamOf(from)?.captainId === userId) throw conflict('Este jogador é o capitão do squad. Peça para ele passar a capitania antes de trocar de squad.', 'CAPTAIN_IN_ROSTER');
  if (!hasGameAccount(user, t)) {
    const game = db().games.find((g) => g.id === t.gameId);
    throw conflict(`${user.nickname} ainda não informou o ID de ${game?.name ?? 'jogo'} em Minha conta. Sem ele, não dá para entrar no elenco.`, 'GAME_ACCOUNT_REQUIRED');
  }
  const before = [...from.members];
  from.members = from.members.filter((m) => m.userId !== userId);
  try {
    addToRoster(t, to, user, { confirmed: true });
  } catch (error) {
    from.members = before;
    throw error;
  }
  settleRosterStatus(t, from);
  const became = settleRosterStatus(t, to);
  save();
  notify([userId], 'TEAM_INVITE', `Você foi remanejado para o ${squadName(to)}`, `A organização de ${t.name} tirou você do ${squadName(from)} e escalou no novo squad.`, `/c/${t.slug}`);
  if (became) notifyConfirmed([to]);
}
