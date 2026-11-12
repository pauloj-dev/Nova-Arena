/**
 * Módulo `submissions` da API simulada: envio de resultado pelo participante, confirmação
 * ou contestação do adversário, validação do staff e disputas (PAR-08, ORG-08, RF-19).
 *
 * Regras centrais:
 * - só quem joga a partida envia (o jogador solo ou o capitão do squad), e só em duelos;
 * - print obrigatório no envio e prova obrigatória na contestação (PRD §16.5, risco R1);
 * - nada disso mexe na tabela: o resultado só vira oficial por `applyMatchResult`
 *   (envio aprovado pelo staff ou disputa resolvida).
 */
import { http, type HttpHandler } from 'msw';
import { applyResult, EngineError, getMatchStatus, type MatchNode, type MatchResultInput } from '@nova/engine';
import {
  CreateSubmissionInput,
  DisputeMessageInput,
  DisputeStatus,
  OpenDisputeInput,
  ResolveDisputeInput,
  ReviewSubmissionInput,
  SubmissionStatus,
  type Dispute,
  type ResultEntryInput,
  type ResultSubmission,
} from '@nova/schemas';
import type { z } from 'zod';
import { audit } from '../audit';
import { publish } from '../bus';
import { findStage, getMeta, getRun, registrationOfUser, splitMatchId, usersOfRegistration, type DbStageRun } from '../competition';
import { collection, db, nowIso, save, uid, type DbRegistration, type DbTournament, type DbUser } from '../db';
import { badRequest, body, conflict, findTournament, forbidden, handle, HttpProblem, isAdmin, json, notFound, param, query, requireTournamentAccess, requireUser, tournamentAccess, url } from '../http';
import { notify } from '../notify';
import { toRegistration } from '../views';
import { applyMatchResult } from './competition';

export const moduleName = 'submissions';

/** Tempo que o adversário tem para confirmar ou contestar antes de o envio ir para a validação do staff. */
export const RESPONSE_WINDOW_MS = 30 * 60_000;

type SubmissionStatusT = z.infer<typeof SubmissionStatus>;
type DisputeStatusT = z.infer<typeof DisputeStatus>;
type DisputeMessageT = Dispute['messages'][number];

/** Registro da coleção `submissions`: o contrato `ResultSubmission` + campos internos. */
export interface DbSubmission extends ResultSubmission {
  stageId: string;
  submittedByUserId: string;
  /** A inscrição do outro lado do duelo (quem pode confirmar ou contestar). */
  opponentRegistrationId: string;
  confirmedByUserId: string | null;
  confirmedAt: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  /** Motivo informado pelo staff ao recusar. */
  rejectReason: string | null;
  disputeId: string | null;
}

export interface DbDisputeMessage extends DisputeMessageT {
  authorId: string;
}

/** Registro da coleção `disputes`: o contrato `Dispute` + campos internos. */
export interface DbDispute extends Dispute {
  stageId: string;
  messages: DbDisputeMessage[];
  openedByUserId: string;
  openedByRegistrationId: string;
  /** As duas inscrições da partida (quem enviou e quem contestou). */
  registrationIds: string[];
  escalatedAt: string | null;
  escalatedByUserId: string | null;
  resolvedByUserId: string | null;
  /** A resolução lançou um resultado oficial na partida. */
  resultApplied: boolean;
}

export const submissions = () => collection<DbSubmission>('submissions');
export const disputes = () => collection<DbDispute>('disputes');

const ACTIVE: SubmissionStatusT[] = ['PENDING', 'CONFIRMED', 'CONTESTED'];

export function toSubmission(s: DbSubmission): ResultSubmission {
  return {
    id: s.id,
    matchId: s.matchId,
    tournamentId: s.tournamentId,
    tournamentName: s.tournamentName,
    matchLabel: s.matchLabel,
    submittedByNickname: s.submittedByNickname,
    submittedByRegistrationId: s.submittedByRegistrationId,
    entries: s.entries,
    winnerRegistrationId: s.winnerRegistrationId,
    evidenceUrls: s.evidenceUrls,
    status: s.status,
    createdAt: s.createdAt,
    respondBy: s.respondBy,
  };
}

export function toDispute(d: DbDispute): Dispute {
  return {
    id: d.id,
    matchId: d.matchId,
    submissionId: d.submissionId,
    tournamentId: d.tournamentId,
    tournamentName: d.tournamentName,
    matchLabel: d.matchLabel,
    openedByNickname: d.openedByNickname,
    reason: d.reason,
    status: d.status,
    resolution: d.resolution,
    messages: d.messages.map((m) => ({ id: m.id, authorNickname: m.authorNickname, authorRole: m.authorRole, body: m.body, evidenceUrls: m.evidenceUrls, createdAt: m.createdAt })),
    createdAt: d.createdAt,
    resolvedAt: d.resolvedAt,
  };
}

// ── Contexto da partida ──────────────────────────────────────────────
interface MatchContext {
  matchId: string;
  stageId: string;
  nodeId: string;
  tournament: DbTournament;
  run: DbStageRun;
  node: MatchNode;
}

function matchContext(matchId: string): MatchContext {
  const { stageId, nodeId } = splitMatchId(matchId);
  const { tournament } = findStage(stageId);
  const run = getRun(stageId);
  // Chave ainda em prévia não existe para o participante.
  if (!run?.confirmed) throw notFound('Partida');
  const node = run.structure.matches.find((m) => m.id === nodeId);
  if (!node) throw notFound('Partida');
  return { matchId, stageId, nodeId, tournament, run, node };
}

const nameOf = (registrationId: string): string => {
  const reg = db().registrations.find((r) => r.id === registrationId);
  return reg ? toRegistration(reg).displayName : 'Inscrito';
};

function labelOf(node: MatchNode): string {
  const names = node.slots.map((s) => (s.entrantId ? nameOf(s.entrantId) : 'A definir'));
  return `${node.roundLabel}: ${names.join(' x ')}`;
}

/** Quem responde por uma inscrição: o próprio jogador (solo) ou o capitão do squad. */
function actsFor(registration: DbRegistration | undefined, userId: string): boolean {
  if (!registration) return false;
  if (registration.userId) return registration.userId === userId;
  return db().teams.find((t) => t.id === registration.teamId)?.captainId === userId;
}

const registrationById = (id: string) => db().registrations.find((r) => r.id === id);

/** Dono e equipe do campeonato: quem recebe os avisos de validação e de disputa. */
function staffUserIds(tournament: DbTournament): string[] {
  return [
    tournament.ownerId,
    ...db()
      .staff.filter((s) => s.tournamentId === tournament.id)
      .map((s) => s.userId),
  ];
}

const adminUserIds = (): string[] =>
  db()
    .users.filter((u) => u.status === 'ACTIVE' && isAdmin(u))
    .map((u) => u.id);

function findSubmission(id: string): DbSubmission {
  const s = submissions().find((x) => x.id === id);
  if (!s) throw notFound('Envio');
  return s;
}
function findDispute(id: string): DbDispute {
  const d = disputes().find((x) => x.id === id);
  if (!d) throw notFound('Disputa');
  return d;
}

/** Envolvido na partida: qualquer membro confirmado de uma das duas inscrições. */
function isInvolved(registrationIds: string[], userId: string): boolean {
  return registrationIds.some((id) => usersOfRegistration(id).includes(userId));
}

function involvedUsers(registrationIds: string[]): string[] {
  return registrationIds.flatMap((id) => usersOfRegistration(id));
}

function setOverride(matchId: string, value: 'AWAITING_VALIDATION' | 'DISPUTED' | null): void {
  const meta = getMeta(matchId);
  meta.statusOverride = value;
  meta.updatedAt = nowIso();
}

function publishMatch(ctx: Pick<MatchContext, 'tournament' | 'matchId' | 'stageId'>, status: string): void {
  publish(`tournament:${ctx.tournament.id}`, { type: 'match.updated', matchId: ctx.matchId, stageId: ctx.stageId, status });
}

/**
 * Confere o placar com o motor sem gravar nada (mesmas regras do lançamento pelo staff:
 * série melhor de N, empate em mata-mata — RN-14). Devolve o vencedor que o motor apurou.
 */
function dryRun(ctx: MatchContext, entries: ResultEntryInput[], winnerRegistrationId: string | null | undefined): string | null {
  let winnerId = winnerRegistrationId ?? undefined;
  const [a, b] = entries;
  if (winnerId === undefined && a && b && (a.score ?? 0) === (b.score ?? 0)) {
    // Empate decidido pelo campo de desempate do jogo (ex.: pênaltis).
    const tiebreak = db()
      .games.find((g) => g.id === ctx.tournament.gameId)
      ?.extraStatFields.find((f) => f.when === 'tiebreak');
    if (tiebreak) {
      const av = a.stats?.[tiebreak.key] ?? 0;
      const bv = b.stats?.[tiebreak.key] ?? 0;
      if (av !== bv) winnerId = av > bv ? a.registrationId : b.registrationId;
    }
  }
  const input: MatchResultInput = {
    matchId: ctx.nodeId,
    entries: entries.map((e) => ({ entrantId: e.registrationId, ...(e.score !== undefined ? { score: e.score } : {}), ...(e.stats ? { stats: e.stats } : {}) })),
    ...(winnerId !== undefined ? { winnerId } : {}),
  };
  try {
    return applyResult(ctx.run.structure, ctx.run.state, input).state.results[ctx.nodeId]?.winnerId ?? null;
  } catch (error) {
    if (error instanceof EngineError) throw new HttpProblem(error.code === 'RESULT_LOCKED' ? 409 : 400, error.message, error.code);
    throw error;
  }
}

function sameResult(submission: DbSubmission, entries: ResultEntryInput[], winnerRegistrationId: string | null | undefined): boolean {
  const score = (list: ResultEntryInput[], id: string) => list.find((e) => e.registrationId === id)?.score ?? null;
  const sameScores = submission.entries.every((e) => score(entries, e.registrationId) === (e.score ?? null));
  return sameScores && (winnerRegistrationId === undefined || winnerRegistrationId === submission.winnerRegistrationId);
}

function authorRole(user: DbUser, tournament: DbTournament): DisputeMessageT['authorRole'] {
  if (isAdmin(user)) return 'ADMIN';
  return tournamentAccess(user, tournament) ? 'STAFF' : 'PARTICIPANT';
}

/** Exige envolvido na partida, staff do campeonato ou Admin. */
function requireDisputeAccess(d: DbDispute): { user: DbUser; tournament: DbTournament; staff: boolean } {
  const user = requireUser();
  const tournament = findTournament(d.tournamentId);
  const staff = tournamentAccess(user, tournament) !== null;
  if (!staff && !isInvolved(d.registrationIds, user.id)) throw forbidden('Só quem está nesta partida ou a organização do campeonato vê a disputa.');
  return { user, tournament, staff };
}

const disputeLink = (id: string) => `/disputas/${id}`;
const matchesLink = (t: DbTournament) => `/c/${t.slug}?aba=partidas`;
const manageLink = (t: DbTournament) => `/organizador/campeonatos/${t.id}`;

export const handlers: HttpHandler[] = [
  // ── Filas do staff ─────────────────────────────────────────────────
  /** "Resultados para validar": confirmados pelo adversário + pendentes cujo prazo de resposta venceu. `?status=` troca o filtro. */
  http.get(
    url('/tournaments/:id/submissions'),
    handle(({ params, request }) => {
      const tournament = findTournament(param(params, 'id'));
      requireTournamentAccess(tournament, { allowModerator: true });
      const raw = query(request).get('status');
      const mine = submissions().filter((s) => s.tournamentId === tournament.id);
      let list: DbSubmission[];
      if (!raw || raw === 'QUEUE') {
        const now = Date.now();
        list = mine.filter((s) => s.status === 'CONFIRMED' || (s.status === 'PENDING' && new Date(s.respondBy).getTime() <= now));
      } else if (raw === 'ALL') {
        list = mine;
      } else {
        const status = SubmissionStatus.safeParse(raw);
        if (!status.success) throw badRequest('Filtro de status inválido.', 'INVALID_STATUS');
        list = mine.filter((s) => s.status === status.data);
      }
      // Fila: os mais antigos primeiro (quem espera há mais tempo).
      return json([...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(toSubmission));
    }),
  ),

  http.get(
    url('/tournaments/:id/disputes'),
    handle(({ params, request }) => {
      const tournament = findTournament(param(params, 'id'));
      requireTournamentAccess(tournament, { allowModerator: true });
      const raw = query(request).get('status');
      const status = raw ? DisputeStatus.safeParse(raw) : null;
      if (status && !status.success) throw badRequest('Filtro de status inválido.', 'INVALID_STATUS');
      const order: Record<DisputeStatusT, number> = { OPEN: 0, ESCALATED: 1, RESOLVED: 2 };
      const list = disputes()
        .filter((d) => d.tournamentId === tournament.id && (!status?.success || d.status === status.data))
        .sort((a, b) => order[a.status] - order[b.status] || b.createdAt.localeCompare(a.createdAt));
      return json(list.map(toDispute));
    }),
  ),

  /** As disputas das partidas em que eu jogo (dos dois lados). */
  http.get(
    url('/me/disputes'),
    handle(() => {
      const user = requireUser();
      const list = disputes()
        .filter((d) => isInvolved(d.registrationIds, user.id))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return json(list.map(toDispute));
    }),
  ),

  // ── Envio pelo participante ────────────────────────────────────────
  http.post(
    url('/matches/:id/submissions'),
    handle(async ({ params, request }) => {
      const user = requireUser();
      const ctx = matchContext(param(params, 'id'));
      const { tournament, node } = ctx;
      const mine = registrationOfUser(tournament.id, user.id);
      if (!mine || mine.status !== 'CONFIRMED' || !node.slots.some((s) => s.entrantId === mine.id)) throw forbidden('Só quem joga esta partida pode enviar o resultado.');
      if (!actsFor(mine, user.id)) throw forbidden('No squad, quem envia o resultado é o capitão.');
      if (node.kind !== 'DUEL') throw badRequest('Em Battle Royale o resultado da queda é lançado pela organização. Mande o print para a organização do campeonato.', 'LOBBY_RESULT_BY_STAFF');
      const input = await body(request, CreateSubmissionInput);

      if (tournament.status === 'PAUSED') throw conflict('O campeonato está pausado. Aguarde a organização retomar.', 'TOURNAMENT_PAUSED');
      if (tournament.status !== 'IN_PROGRESS') throw conflict('O campeonato não está em andamento.', 'TOURNAMENT_NOT_RUNNING');
      if (ctx.run.state.results[ctx.nodeId]) throw conflict('Esta partida já tem resultado oficial.', 'MATCH_FINISHED');
      const engineStatus = getMatchStatus(ctx.run.structure, ctx.run.state, ctx.nodeId);
      const opponentId = node.slots.find((s) => s.entrantId !== mine.id)?.entrantId ?? null;
      if (node.slots.length !== 2 || !opponentId || engineStatus !== 'READY') throw conflict('Esta partida ainda não está pronta para receber resultado.', 'MATCH_NOT_READY');
      if (submissions().some((s) => s.matchId === ctx.matchId && ACTIVE.includes(s.status))) {
        throw conflict('Já existe um resultado enviado para esta partida aguardando resposta.', 'SUBMISSION_EXISTS');
      }

      // Na ordem das vagas da partida, a mesma de `matchLabel` ("A x B").
      const sides = node.slots.map((slot) => slot.entrantId as string);
      const complete = input.entries.length === 2 && sides.every((id) => input.entries.some((e) => e.registrationId === id && e.score !== undefined));
      if (!complete) throw badRequest('Informe o placar dos dois lados da partida.', 'INVALID_RESULT');
      // Só estatísticas brutas de duelo: placar e campo de desempate. Pontos nunca vêm do cliente (RN-01).
      const entries: ResultEntryInput[] = sides.map((id) => {
        const e = input.entries.find((x) => x.registrationId === id) as ResultEntryInput;
        return { registrationId: id, score: e.score, ...(e.stats ? { stats: e.stats } : {}) };
      });
      const winnerRegistrationId = dryRun(ctx, entries, input.winnerRegistrationId);

      const now = Date.now();
      const record: DbSubmission = {
        id: uid('sub'),
        matchId: ctx.matchId,
        tournamentId: tournament.id,
        tournamentName: tournament.name,
        matchLabel: labelOf(node),
        submittedByNickname: user.nickname,
        submittedByRegistrationId: mine.id,
        entries,
        winnerRegistrationId,
        evidenceUrls: input.evidenceUrls,
        status: 'PENDING',
        createdAt: new Date(now).toISOString(),
        respondBy: new Date(now + RESPONSE_WINDOW_MS).toISOString(),
        stageId: ctx.stageId,
        submittedByUserId: user.id,
        opponentRegistrationId: opponentId,
        confirmedByUserId: null,
        confirmedAt: null,
        reviewedByUserId: null,
        reviewedAt: null,
        rejectReason: null,
        disputeId: null,
      };
      submissions().push(record);
      setOverride(ctx.matchId, 'AWAITING_VALIDATION');
      save();

      notify(usersOfRegistration(opponentId), 'RESULT_POSTED', 'Confirme o resultado da sua partida', `${user.nickname} enviou o placar de ${record.matchLabel} (${tournament.name}). Você tem 30 minutos para confirmar ou contestar.`, matchesLink(tournament));
      publishMatch(ctx, 'AWAITING_VALIDATION');
      return json(toSubmission(record), 201);
    }),
  ),

  /** O envio ativo da partida (pendente, confirmado ou contestado), ou `null`. Só para os dois lados e o staff. */
  http.get(
    url('/matches/:id/submission'),
    handle(({ params }) => {
      const user = requireUser();
      const ctx = matchContext(param(params, 'id'));
      const staff = tournamentAccess(user, ctx.tournament) !== null;
      const sides = ctx.node.slots.map((s) => s.entrantId).filter((x): x is string => x !== null);
      if (!staff && !isInvolved(sides, user.id)) throw forbidden('Só quem joga esta partida ou a organização vê o resultado enviado.');
      const active = submissions()
        .filter((s) => s.matchId === ctx.matchId && ACTIVE.includes(s.status))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      return json(active ? toSubmission(active) : null);
    }),
  ),

  // ── Resposta do adversário ─────────────────────────────────────────
  http.post(
    url('/submissions/:id/confirm'),
    handle(({ params }) => {
      const user = requireUser();
      const s = findSubmission(param(params, 'id'));
      const ctx = matchContext(s.matchId);
      requireOpponent(s, user);
      if (s.status !== 'PENDING') throw conflict('Este envio já foi respondido.', 'SUBMISSION_NOT_PENDING');
      s.status = 'CONFIRMED';
      s.confirmedByUserId = user.id;
      s.confirmedAt = nowIso();
      getMeta(s.matchId).updatedAt = nowIso();
      save();
      notify(usersOfRegistration(s.submittedByRegistrationId), 'RESULT_POSTED', 'O adversário confirmou o resultado', `${s.matchLabel} (${s.tournamentName}) agora aguarda a validação da organização.`, matchesLink(ctx.tournament));
      notify(staffUserIds(ctx.tournament), 'RESULT_POSTED', 'Resultado para validar', `${s.matchLabel} (${s.tournamentName}): os dois lados concordam com o placar enviado.`, manageLink(ctx.tournament));
      publishMatch(ctx, 'AWAITING_VALIDATION');
      return json(toSubmission(s));
    }),
  ),

  /** Contestação: prova obrigatória (PRD §16.5). O resultado contestado não altera a tabela até ser resolvido. */
  http.post(
    url('/submissions/:id/dispute'),
    handle(async ({ params, request }) => {
      const user = requireUser();
      const s = findSubmission(param(params, 'id'));
      const ctx = matchContext(s.matchId);
      requireOpponent(s, user);
      const input = await body(request, OpenDisputeInput);
      if (s.status !== 'PENDING') throw conflict('Este envio já foi respondido.', 'SUBMISSION_NOT_PENDING');

      const at = nowIso();
      const record: DbDispute = {
        id: uid('dp'),
        matchId: s.matchId,
        submissionId: s.id,
        tournamentId: s.tournamentId,
        tournamentName: s.tournamentName,
        matchLabel: s.matchLabel,
        openedByNickname: user.nickname,
        reason: input.reason,
        status: 'OPEN',
        resolution: null,
        // A contestação abre o histórico, com as provas de quem contestou.
        messages: [{ id: uid('dm'), authorId: user.id, authorNickname: user.nickname, authorRole: 'PARTICIPANT', body: input.reason, evidenceUrls: input.evidenceUrls, createdAt: at }],
        createdAt: at,
        resolvedAt: null,
        stageId: s.stageId,
        openedByUserId: user.id,
        openedByRegistrationId: s.opponentRegistrationId,
        registrationIds: [s.submittedByRegistrationId, s.opponentRegistrationId],
        escalatedAt: null,
        escalatedByUserId: null,
        resolvedByUserId: null,
        resultApplied: false,
      };
      disputes().push(record);
      s.status = 'CONTESTED';
      s.disputeId = record.id;
      setOverride(s.matchId, 'DISPUTED');
      save();

      notify(usersOfRegistration(s.submittedByRegistrationId), 'DISPUTE_UPDATE', 'Seu resultado foi contestado', `${user.nickname} contestou o placar de ${s.matchLabel} (${s.tournamentName}). A organização vai analisar as provas.`, disputeLink(record.id));
      notify(staffUserIds(ctx.tournament), 'DISPUTE_UPDATE', 'Nova disputa para analisar', `${s.matchLabel} (${s.tournamentName}): ${user.nickname} contestou o resultado enviado por ${s.submittedByNickname}.`, disputeLink(record.id));
      publishMatch(ctx, 'DISPUTED');
      return json(toDispute(record), 201);
    }),
  ),

  // ── Validação do staff ─────────────────────────────────────────────
  /** Detalhe de um envio (inclusive já encerrado), para a tela da disputa. */
  http.get(
    url('/submissions/:id'),
    handle(({ params }) => {
      const user = requireUser();
      const s = findSubmission(param(params, 'id'));
      const tournament = findTournament(s.tournamentId);
      const staff = tournamentAccess(user, tournament) !== null;
      if (!staff && !isInvolved([s.submittedByRegistrationId, s.opponentRegistrationId], user.id)) throw forbidden('Só quem joga esta partida ou a organização vê o resultado enviado.');
      return json(toSubmission(s));
    }),
  ),

  http.patch(
    url('/submissions/:id'),
    handle(async ({ params, request }) => {
      const s = findSubmission(param(params, 'id'));
      const tournament = findTournament(s.tournamentId);
      const { user } = requireTournamentAccess(tournament, { allowModerator: true });
      const input = await body(request, ReviewSubmissionInput);
      if (s.status === 'CONTESTED') throw conflict('Este envio foi contestado: resolva pela disputa.', 'SUBMISSION_CONTESTED');
      if (s.status !== 'PENDING' && s.status !== 'CONFIRMED') throw conflict('Este envio já foi analisado.', 'SUBMISSION_REVIEWED');

      if (input.action === 'approve') {
        // Enquanto o adversário ainda pode responder, o envio não entra na fila de validação.
        if (s.status === 'PENDING' && new Date(s.respondBy).getTime() > Date.now()) {
          throw conflict('O adversário ainda está no prazo para confirmar ou contestar este envio.', 'SUBMISSION_AWAITING_OPPONENT');
        }
        // É por aqui que o envio vira resultado oficial: os pontos são calculados pelo servidor.
        applyMatchResult(user, s.matchId, { entries: s.entries, winnerRegistrationId: s.winnerRegistrationId, evidenceUrls: s.evidenceUrls }, { source: 'SUBMISSION' });
        s.status = 'APPROVED';
      } else {
        s.status = 'REJECTED';
        s.rejectReason = input.reason;
        setOverride(s.matchId, null);
        notify(usersOfRegistration(s.submittedByRegistrationId), 'RESULT_POSTED', 'Seu envio de resultado foi recusado', `${s.matchLabel} (${s.tournamentName}): ${input.reason}`, matchesLink(tournament));
        publish(`tournament:${tournament.id}`, { type: 'match.updated', matchId: s.matchId, stageId: s.stageId, status: 'SCHEDULED' });
      }
      s.reviewedByUserId = user.id;
      s.reviewedAt = nowIso();
      save();
      return json(toSubmission(s));
    }),
  ),

  // ── Disputas ───────────────────────────────────────────────────────
  http.post(
    url('/disputes/:id/messages'),
    handle(async ({ params, request }) => {
      const d = findDispute(param(params, 'id'));
      const { user, tournament } = requireDisputeAccess(d);
      const input = await body(request, DisputeMessageInput);
      if (d.status === 'RESOLVED') throw conflict('Esta disputa já foi resolvida e não recebe novas mensagens.', 'DISPUTE_CLOSED');
      d.messages.push({ id: uid('dm'), authorId: user.id, authorNickname: user.nickname, authorRole: authorRole(user, tournament), body: input.body, evidenceUrls: input.evidenceUrls, createdAt: nowIso() });
      save();
      const others = [...involvedUsers(d.registrationIds), ...staffUserIds(tournament), ...(d.status === 'ESCALATED' ? adminUserIds() : [])].filter((id) => id !== user.id);
      notify(others, 'DISPUTE_UPDATE', 'Nova mensagem na disputa', `${user.nickname} escreveu na disputa de ${d.matchLabel} (${d.tournamentName}).`, disputeLink(d.id));
      return json(toDispute(d), 201);
    }),
  ),

  /** O staff do campeonato passa a decisão para a administração da plataforma. */
  http.post(
    url('/disputes/:id/escalate'),
    handle(({ params }) => {
      const d = findDispute(param(params, 'id'));
      const tournament = findTournament(d.tournamentId);
      const { user } = requireTournamentAccess(tournament, { allowModerator: true });
      if (d.status !== 'OPEN') throw conflict(d.status === 'ESCALATED' ? 'Esta disputa já foi escalada para a administração.' : 'Esta disputa já foi resolvida.', 'DISPUTE_NOT_OPEN');
      const at = nowIso();
      d.status = 'ESCALATED';
      d.escalatedAt = at;
      d.escalatedByUserId = user.id;
      d.messages.push({ id: uid('dm'), authorId: user.id, authorNickname: user.nickname, authorRole: authorRole(user, tournament), body: 'Disputa escalada para a administração da Nova Arena.', evidenceUrls: [], createdAt: at });
      save();
      notify(involvedUsers(d.registrationIds), 'DISPUTE_UPDATE', 'Disputa escalada para a administração', `A organização passou a decisão sobre ${d.matchLabel} (${d.tournamentName}) para a administração da Nova Arena.`, disputeLink(d.id));
      notify(
        adminUserIds().filter((id) => id !== user.id),
        'DISPUTE_UPDATE',
        'Disputa escalada para análise',
        `${d.matchLabel} (${d.tournamentName}) aguarda decisão da administração.`,
        disputeLink(d.id),
      );
      return json(toDispute(d));
    }),
  ),

  /** Resolve a disputa. Com `result`, lança o resultado correto (oficial). Escalada: só Admin resolve. */
  http.post(
    url('/disputes/:id/resolve'),
    handle(async ({ params, request }) => {
      const d = findDispute(param(params, 'id'));
      const tournament = findTournament(d.tournamentId);
      const { user, access } = requireTournamentAccess(tournament, { allowModerator: true });
      const input = await body(request, ResolveDisputeInput);
      if (d.status === 'RESOLVED') throw conflict('Esta disputa já foi resolvida.', 'DISPUTE_NOT_OPEN');
      if (d.status === 'ESCALATED' && access !== 'ADMIN') throw forbidden('Esta disputa foi escalada: agora só a administração da Nova Arena pode resolver.');

      const previous = d.status;
      const submission = d.submissionId ? submissions().find((s) => s.id === d.submissionId) : undefined;
      if (input.result) {
        // Sem prova nova na resolução, a partida fica com o print do envio original.
        const evidenceUrls = input.result.evidenceUrls.length > 0 ? input.result.evidenceUrls : (submission?.evidenceUrls ?? []);
        applyMatchResult(user, d.matchId, { ...input.result, evidenceUrls }, { source: 'DISPUTE' });
      } else {
        // Sem resultado: a partida volta ao estado normal e pode receber um novo envio.
        setOverride(d.matchId, null);
      }
      const at = nowIso();
      d.status = 'RESOLVED';
      d.resolution = input.resolution;
      d.resolvedAt = at;
      d.resolvedByUserId = user.id;
      d.resultApplied = Boolean(input.result);
      if (submission) {
        submission.status = input.result && sameResult(submission, input.result.entries, input.result.winnerRegistrationId) ? 'APPROVED' : 'REJECTED';
        submission.reviewedByUserId = user.id;
        submission.reviewedAt = at;
      }
      save();
      audit(user, {
        action: 'DISPUTE_RESOLVED',
        entityType: 'Dispute',
        entityId: d.id,
        entityLabel: `${d.matchLabel} · ${d.tournamentName}`,
        tournamentId: tournament.id,
        before: { status: previous },
        after: { status: 'RESOLVED', resultadoLancado: d.resultApplied },
        reason: input.resolution,
      });
      notify(
        involvedUsers(d.registrationIds),
        'DISPUTE_UPDATE',
        'Disputa resolvida',
        `${d.matchLabel} (${d.tournamentName}): ${d.resultApplied ? 'o resultado oficial foi lançado.' : 'o resultado enviado foi anulado e a partida aguarda novo resultado.'}`,
        disputeLink(d.id),
      );
      if (!d.resultApplied) publish(`tournament:${tournament.id}`, { type: 'match.updated', matchId: d.matchId, stageId: d.stageId, status: 'SCHEDULED' });
      return json(toDispute(d));
    }),
  ),

  http.get(
    url('/disputes/:id'),
    handle(({ params }) => {
      const d = findDispute(param(params, 'id'));
      requireDisputeAccess(d);
      return json(toDispute(d));
    }),
  ),
];

/** Só o outro lado do duelo responde ao envio — nunca quem enviou. */
function requireOpponent(s: DbSubmission, user: DbUser): void {
  const sameSide = usersOfRegistration(s.submittedByRegistrationId).includes(user.id);
  if (sameSide) throw forbidden('Quem enviou o resultado não pode responder ao próprio envio. A confirmação é do adversário.');
  if (!actsFor(registrationById(s.opponentRegistrationId), user.id)) {
    throw forbidden(isInvolved([s.opponentRegistrationId], user.id) ? 'No squad, quem responde ao resultado é o capitão.' : 'Só o adversário desta partida pode responder ao envio.');
  }
}
