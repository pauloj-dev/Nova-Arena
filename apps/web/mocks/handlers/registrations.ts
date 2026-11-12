/**
 * Módulo `registrations` da API simulada: inscrição solo e com squad, confirmação dos membros,
 * cancelamento, lista de espera e "Meus campeonatos" (PRD §9 PAR-04 a 06, §12.2, RN-06, RN-12).
 * As decisões (status inicial, promoção, prazo de cancelamento) são funções puras de
 * `features/registrations/lib/rules.ts`; aqui ficam permissão, leitura e gravação.
 */
import { http } from 'msw';
import { ACTIVE_REGISTRATION_STATUSES, RegisterInTournamentInput, type GameMode, type MyTournamentEntry, type RegistrationEligibility, type TournamentStatus } from '@nova/schemas';
import {
  canCancelRegistration,
  checkSquadSize,
  initialRegistrationStatus,
  isCurrentEntry,
  isReservationExpired,
  planPromotions,
  registrationWindow,
  squadSizeMessage,
  statusAfterMemberConfirmation,
} from '@/features/registrations/lib/rules';
import { formatDateTime } from '@/shared/lib/datetime';
import { listMatches, podiums } from '../competition';
import { applyDueWalkovers } from './competition';
import { db, nowIso, save, uid, type DbRegistration, type DbTeam, type DbTournament, type DbUser } from '../db';
import { badRequest, conflict, body, currentUser, findTournament, forbidden, handle, HttpProblem, json, noContent, notFound, param, requireUser, url } from '../http';
import { findUser, takenSlots, toRegistration, toTournamentSummary } from '../views';

export const moduleName = 'registrations';

/** Estados em que a fila anda sozinha. Depois do check-in só a organização substitui (RN-06). */
const AUTO_PROMOTION_STATUSES: TournamentStatus[] = ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED'];
/** Estados em que um membro ainda pode confirmar ou recusar a participação. */
const CONFIRMATION_STATUSES: TournamentStatus[] = ['PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED'];

const isActive = (r: DbRegistration) => ACTIVE_REGISTRATION_STATUSES.includes(r.status);
const confirmedCount = (r: DbRegistration) => r.members.filter((m) => m.confirmedAt !== null).length;
const involves = (r: DbRegistration, userId: string) => r.userId === userId || r.members.some((m) => m.userId === userId);

function gameAndMode(t: DbTournament) {
  const game = db().games.find((g) => g.id === t.gameId);
  const mode: GameMode | undefined = game?.modes.find((m) => m.id === t.gameModeId);
  if (!game || !mode) throw new HttpProblem(500, 'Campeonato sem jogo ou modo configurado.');
  return { game, mode };
}

/** Dono ou equipe do campeonato. Admin que não é da equipe pode se inscrever (PRD §6). */
function isOrganizerOf(user: DbUser, t: DbTournament): boolean {
  return t.ownerId === user.id || db().staff.some((s) => s.tournamentId === t.id && s.userId === user.id);
}

function visibleTournament(idOrSlug: string): DbTournament {
  const t = findTournament(idOrSlug);
  // Rascunho não existe para o público.
  if (t.status === 'DRAFT') throw notFound('Campeonato');
  return t;
}

function findRegistration(id: string): { registration: DbRegistration; tournament: DbTournament } {
  const registration = db().registrations.find((r) => r.id === id);
  const tournament = registration ? db().tournaments.find((t) => t.id === registration.tournamentId) : undefined;
  if (!registration || !tournament) throw notFound('Inscrição');
  return { registration, tournament };
}

/** Exige o ID do jogo quando o jogo tem campos obrigatórios (PAR-04). */
function assertGameAccount(user: DbUser, t: DbTournament): void {
  const { game } = gameAndMode(t);
  if (game.requiredAccountFields.length === 0) return;
  if (user.gameAccounts.some((a) => a.gameId === game.id)) return;
  throw badRequest(`Para jogar este campeonato, informe seu ID de ${game.name} em Minha conta.`, 'GAME_ACCOUNT_REQUIRED');
}

/** RN-15: quem se inscreve passa a seguir o campeonato. */
function follow(userId: string, tournamentId: string): void {
  const d = db();
  if (!d.follows.some((f) => f.userId === userId && f.targetType === 'TOURNAMENT' && f.targetId === tournamentId)) {
    d.follows.push({ userId, targetType: 'TOURNAMENT', targetId: tournamentId });
  }
}

/**
 * Coloca a fila em dia: devolve à lista de espera o squad promovido que não completou em 24 h
 * e promove os primeiros da fila para as vagas livres (RN-12).
 *
 * No protótipo isso roda "sob demanda", antes de cada leitura ou mudança de inscrição.
 * Na API real (B1) é um job agendado (Vercel Cron), além da chamada no cancelamento.
 */
function settleWaitlist(t: DbTournament, now: Date = new Date()): void {
  if (!AUTO_PROMOTION_STATUSES.includes(t.status)) return;
  const d = db();
  const { mode } = gameAndMode(t);
  let changed = false;

  d.registrations
    .filter((r) => r.tournamentId === t.id && isReservationExpired(r, now))
    .forEach((r, index) => {
      r.status = 'WAITLIST';
      r.reservedUntil = null;
      // A posição na fila é a ordem de `createdAt`: voltar ao fim da fila é entrar de novo agora.
      r.createdAt = new Date(now.getTime() + index).toISOString();
      changed = true;
    });

  const freeSlots = t.maxParticipants - takenSlots(t.id);
  if (freeSlots > 0) {
    const waitlist = d.registrations
      .filter((r) => r.tournamentId === t.id && r.status === 'WAITLIST')
      .map((r) => ({ id: r.id, createdAt: r.createdAt, isTeam: r.teamId !== null, confirmedMembers: confirmedCount(r), requiredMembers: mode.teamSize }));
    for (const promotion of planPromotions({ freeSlots, waitlist, manualApproval: t.manualApproval, registrationClosesAt: t.registrationClosesAt, now })) {
      const r = d.registrations.find((x) => x.id === promotion.id);
      if (!r) continue;
      r.status = promotion.status;
      r.reservedUntil = promotion.reservedUntil;
      changed = true;
      // Ponto de extensão (F2): notificar o promovido ("Sua vaga saiu!") em `collection('notifications')`.
    }
  }
  if (changed) save();
}

/** A inscrição do usuário neste campeonato: a ativa; senão, a última encerrada pela organização. */
function myRegistrationIn(t: DbTournament, userId: string): DbRegistration | undefined {
  const mine = db().registrations.filter((r) => r.tournamentId === t.id && involves(r, userId));
  return (
    mine.find(isActive) ??
    mine
      .filter((r) => r.status !== 'CANCELLED')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  );
}

/** Status de partida que ainda não acabou para quem joga. */
const OPEN_MATCH_STATUSES = ['SCHEDULED', 'CHECK_IN', 'LIVE', 'AWAITING_VALIDATION', 'DISPUTED'];
/** Estados do campeonato em que pode existir partida por jogar. */
const MATCH_TOURNAMENT_STATUSES: TournamentStatus[] = ['REGISTRATION_CLOSED', 'CHECK_IN', 'IN_PROGRESS', 'PAUSED'];

/**
 * Próxima partida e colocação final de uma inscrição (PAR-06).
 * - `nextMatch`: a partida ainda por jogar da inscrição com o horário mais próximo (sem horário fica por último).
 *   `checkInOpen` é verdadeiro enquanto a janela está aberta e o check-in da inscrição ainda não foi concluído.
 * - `finalPlacement`: o lugar no pódio, quando o campeonato terminou e a inscrição ficou entre os três primeiros.
 */
function competitionInfo(t: DbTournament, registration: DbRegistration): Pick<MyTournamentEntry, 'nextMatch' | 'finalPlacement'> {
  const ended = t.status === 'FINISHED' || t.status === 'ARCHIVED';
  const finalPlacement = ended ? (podiums().find((p) => p.tournamentId === t.id)?.places.find((p) => p.registrationId === registration.id)?.place ?? null) : null;
  if (registration.status !== 'CONFIRMED' || !MATCH_TOURNAMENT_STATUSES.includes(t.status)) return { nextMatch: null, finalPlacement };

  // Mesmo "job" de W.O. por falta de check-in que a página do campeonato aplica antes de ler.
  applyDueWalkovers(t);
  const mine = listMatches(t.id)
    .filter((m) => OPEN_MATCH_STATUSES.includes(m.status) && m.participants.some((p) => p.registrationId === registration.id))
    .sort((a, b) => {
      if (a.scheduledAt && b.scheduledAt) return a.scheduledAt.localeCompare(b.scheduledAt);
      if (a.scheduledAt) return -1;
      if (b.scheduledAt) return 1;
      return a.round - b.round || a.position - b.position;
    });
  const next = mine[0];
  if (!next) return { nextMatch: null, finalPlacement };

  const me = next.participants.find((p) => p.registrationId === registration.id);
  const opponent = next.kind === 'DUEL' ? next.participants.find((p) => p.registrationId !== registration.id) : undefined;
  return {
    nextMatch: {
      id: next.id,
      label: [next.stageName, next.groupName, next.roundLabel].filter(Boolean).join(' · '),
      scheduledAt: next.scheduledAt,
      opponent: opponent?.registrationId ? opponent.name : null,
      checkInOpen: next.status === 'CHECK_IN' && !me?.checkedIn,
    },
    finalPlacement,
  };
}

export const handlers = [
  /** "Meus campeonatos": uma entrada por campeonato em que estou (solo ou no elenco de um squad). */
  http.get(
    url('/me/registrations'),
    handle(() => {
      const user = requireUser();
      const d = db();
      const tournamentIds = [...new Set(d.registrations.filter((r) => involves(r, user.id)).map((r) => r.tournamentId))];
      const entries: MyTournamentEntry[] = [];
      for (const id of tournamentIds) {
        const t = d.tournaments.find((x) => x.id === id);
        if (!t || t.status === 'DRAFT') continue;
        settleWaitlist(t);
        // Uma inscrição por campeonato: a ativa; sem ativa, a mais recente (inclusive cancelada, para o histórico).
        const mine = d.registrations.filter((r) => r.tournamentId === id && involves(r, user.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const registration = mine.find(isActive) ?? mine[0];
        if (!registration) continue;
        entries.push({ tournament: toTournamentSummary(t), registration: toRegistration(registration), ...competitionInfo(t, registration) });
      }
      // Os que estão valendo vêm primeiro, pela data mais próxima; o histórico, do mais recente para o mais antigo.
      const live = isCurrentEntry;
      const startsAt = (e: MyTournamentEntry) => e.tournament.startsAt ?? '9999';
      entries.sort((a, b) => Number(live(b)) - Number(live(a)) || (live(a) ? startsAt(a).localeCompare(startsAt(b)) : startsAt(b).localeCompare(startsAt(a))));
      return json(entries);
    }),
  ),

  /** Minha inscrição neste campeonato, ou `null`. Visitante recebe `null` (e não 401): a página do campeonato é pública. */
  http.get(
    url('/tournaments/:id/my-registration'),
    handle(({ params }) => {
      const t = visibleTournament(param(params, 'id'));
      const user = currentUser();
      if (!user) return json(null);
      settleWaitlist(t);
      const registration = myRegistrationIn(t, user.id);
      return json(registration ? toRegistration(registration) : null);
    }),
  ),

  /** O que a tela não consegue saber sozinha: se quem está vendo é da organização deste campeonato. */
  http.get(
    url('/tournaments/:id/registration-eligibility'),
    handle(({ params }) => {
      const t = visibleTournament(param(params, 'id'));
      const user = currentUser();
      const eligibility: RegistrationEligibility = { isOrganizer: user !== null && isOrganizerOf(user, t) };
      return json(eligibility);
    }),
  ),

  http.post(
    url('/tournaments/:id/registrations'),
    handle(async ({ params, request }) => {
      const user = requireUser();
      const t = visibleTournament(param(params, 'id'));
      const input = await body(request, RegisterInTournamentInput);
      const d = db();
      const { mode } = gameAndMode(t);

      if (isOrganizerOf(user, t)) throw new HttpProblem(403, 'Você faz parte da organização deste campeonato, então não pode se inscrever nele.', 'OWN_TOURNAMENT');

      const window = registrationWindow(t);
      if (window === 'NOT_OPEN_YET') {
        const when = t.registrationOpensAt ? ` Elas abrem em ${formatDateTime(t.registrationOpensAt)}.` : '';
        throw conflict(`As inscrições deste campeonato ainda não abriram.${when}`, 'REGISTRATION_NOT_OPEN');
      }
      if (window !== 'OPEN') throw conflict(window === 'CANCELLED' ? 'Este campeonato foi cancelado.' : 'As inscrições deste campeonato já foram encerradas.', 'REGISTRATION_CLOSED');

      const others = d.registrations.filter((r) => r.tournamentId === t.id);
      // Quem foi recusado ou desclassificado pela organização não entra de novo por conta própria.
      const barred = others.find((r) => (r.status === 'REJECTED' || r.status === 'DISQUALIFIED') && (r.userId === user.id || (input.teamId !== undefined && r.teamId === input.teamId)));
      if (barred) throw conflict('A organização recusou esta inscrição. Fale com o organizador para entender o motivo.', 'REGISTRATION_REJECTED');

      let team: DbTeam | undefined;
      if (t.participantType === 'SOLO') {
        if (input.teamId) throw badRequest('Este campeonato é individual: a inscrição é só sua, sem squad.', 'SOLO_ONLY', { teamId: 'Este campeonato é individual.' });
        if (others.some((r) => isActive(r) && r.userId === user.id)) throw conflict('Você já está inscrito neste campeonato.', 'ALREADY_REGISTERED');
      } else {
        if (!input.teamId) throw badRequest('Este campeonato é por squad. Escolha o squad que vai jogar.', 'TEAM_REQUIRED', { teamId: 'Escolha um squad.' });
        team = d.teams.find((x) => x.id === input.teamId);
        if (!team) throw notFound('Squad');
        if (team.captainId !== user.id) throw new HttpProblem(403, 'Só o capitão pode inscrever o squad.', 'NOT_CAPTAIN');
        if (others.some((r) => isActive(r) && r.teamId === team?.id)) throw conflict(`O ${team.name} já está inscrito neste campeonato.`, 'ALREADY_REGISTERED');

        const size = checkSquadSize(team.members.length, mode);
        if (!size.ok) throw conflict(squadSizeMessage(size, mode) ?? 'O tamanho do squad não serve para este modo.', size.reason === 'TOO_SMALL' ? 'TEAM_TOO_SMALL' : 'TEAM_TOO_BIG');

        // Exclusividade (PRD §12.1): ninguém joga o mesmo campeonato por dois squads.
        for (const member of team.members) {
          const clash = others.find((r) => isActive(r) && involves(r, member.userId));
          if (!clash) continue;
          const who = member.userId === user.id ? 'Você já está inscrito' : `${findUser(member.userId)?.nickname ?? 'Um jogador do squad'} já está inscrito`;
          const where = d.teams.find((x) => x.id === clash.teamId)?.name;
          throw conflict(`${who} neste campeonato${where ? ` pelo squad ${where}` : ''}. Um jogador não pode estar em dois squads no mesmo campeonato.`, 'PLAYER_IN_OTHER_TEAM');
        }
      }

      // Solo: o ID do jogo é obrigatório já na inscrição. Squad: o capitão conta como confirmado, então vale para ele também.
      assertGameAccount(user, t);

      settleWaitlist(t);
      const status = initialRegistrationStatus({
        freeSlots: t.maxParticipants - takenSlots(t.id),
        waitlistEnabled: t.waitlistEnabled,
        manualApproval: t.manualApproval,
        isTeam: team !== undefined,
        confirmedMembers: 1,
        requiredMembers: mode.teamSize,
      });
      if (status === 'FULL') throw conflict('As vagas deste campeonato estão esgotadas e ele não tem lista de espera.', 'TOURNAMENT_FULL');

      const now = nowIso();
      const registration: DbRegistration = {
        id: uid('r'),
        tournamentId: t.id,
        userId: team ? null : user.id,
        teamId: team?.id ?? null,
        importedName: null,
        importedTag: null,
        status,
        seed: null,
        statusReason: null,
        // Elenco do squad neste campeonato: uma foto dos membros no momento da inscrição.
        members: team ? team.members.map((m) => ({ userId: m.userId, isSub: m.isSub, confirmedAt: m.userId === user.id ? now : null })) : [],
        reservedUntil: null,
        createdAt: now,
      };
      d.registrations.push(registration);
      follow(user.id, t.id);
      // Ponto de extensão (F2): notificar os membros ("Confirme sua participação") e, com aprovação manual, a organização.
      save();
      return json(toRegistration(registration), 201);
    }),
  ),

  /** Membro do squad confirma a participação. Ao atingir o mínimo, a inscrição avança. */
  http.post(
    url('/registrations/:id/confirm'),
    handle(({ params }) => {
      const user = requireUser();
      const { registration: r, tournament: t } = findRegistration(param(params, 'id'));
      const member = r.members.find((m) => m.userId === user.id);
      if (!r.teamId || !member) throw forbidden('Você não está no elenco desta inscrição.');
      if (!isActive(r)) throw conflict('Esta inscrição não está mais ativa.', 'REGISTRATION_INACTIVE');
      if (!CONFIRMATION_STATUSES.includes(t.status)) throw conflict('O campeonato já começou: não dá mais para confirmar participação.', 'CONFIRMATION_CLOSED');
      assertGameAccount(user, t);

      settleWaitlist(t);
      if (member.confirmedAt === null) {
        member.confirmedAt = nowIso();
        const { mode } = gameAndMode(t);
        const next = statusAfterMemberConfirmation(r.status, { manualApproval: t.manualApproval, confirmedMembers: confirmedCount(r), requiredMembers: mode.teamSize });
        if (next !== r.status) {
          r.status = next;
          // O squad completou dentro do prazo: a vaga deixa de ser só uma reserva.
          r.reservedUntil = null;
        }
        follow(user.id, t.id);
        save();
      }
      return json(toRegistration(r));
    }),
  ),

  /** Membro recusa: sai do elenco desta inscrição (continua no squad). */
  http.post(
    url('/registrations/:id/decline'),
    handle(({ params }) => {
      const user = requireUser();
      const { registration: r, tournament: t } = findRegistration(param(params, 'id'));
      const member = r.members.find((m) => m.userId === user.id);
      if (!r.teamId || !member) throw forbidden('Você não está no elenco desta inscrição.');
      if (!isActive(r)) throw conflict('Esta inscrição não está mais ativa.', 'REGISTRATION_INACTIVE');
      const team = db().teams.find((x) => x.id === r.teamId);
      if (team?.captainId === user.id) throw conflict('Você é o capitão: para tirar o squad do campeonato, cancele a inscrição.', 'CAPTAIN_CANNOT_DECLINE');
      if (member.confirmedAt !== null) throw conflict('Você já confirmou a participação. Para sair agora, fale com o capitão do squad.', 'ALREADY_CONFIRMED');
      if (!CONFIRMATION_STATUSES.includes(t.status)) throw conflict('O campeonato já começou: fale com o capitão do squad.', 'CONFIRMATION_CLOSED');
      r.members = r.members.filter((m) => m.userId !== user.id);
      save();
      return noContent();
    }),
  ),

  /** Cancelar (RN-06): só o inscrito ou o capitão, e só até o prazo. Libera a vaga e a fila anda. */
  http.delete(
    url('/registrations/:id'),
    handle(({ params }) => {
      const user = requireUser();
      const { registration: r, tournament: t } = findRegistration(param(params, 'id'));
      const team = r.teamId ? db().teams.find((x) => x.id === r.teamId) : undefined;
      const owner = r.teamId ? team?.captainId === user.id : r.userId === user.id;
      if (!owner) throw forbidden(r.teamId ? 'Só o capitão do squad pode cancelar a inscrição.' : 'Só quem se inscreveu pode cancelar a inscrição.');
      if (!isActive(r)) throw conflict('Esta inscrição já não está ativa.', 'REGISTRATION_INACTIVE');
      if (!canCancelRegistration(t)) {
        throw conflict('O prazo para cancelar a inscrição já passou. Para desistir agora, fale com a organização do campeonato.', 'CANCELLATION_CLOSED');
      }
      r.status = 'CANCELLED';
      r.reservedUntil = null;
      save();
      settleWaitlist(t);
      return noContent();
    }),
  ),
];
