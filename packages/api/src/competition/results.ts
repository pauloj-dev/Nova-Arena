/**
 * Lançamento de resultado (issue #85, PRD ORG-07, RF-11, RF-12, RN-01 a RN-03, RN-14) e histórico como eventos
 * (issue #86). É a **única** porta para um resultado virar oficial: o lançamento do staff, a importação, o envio do
 * participante aprovado e a disputa resolvida passam todos por `applyMatchResult` (mesma regra da API simulada).
 *
 * Numa transação, com a fase travada (`SELECT … FOR UPDATE`):
 * - o motor aplica o resultado e avança o vencedor; os pontos saem das estatísticas brutas (o cliente nunca manda);
 * - a projeção, as kills por jogador, as provas, a tabela `standings`, o evento do histórico e a auditoria são
 *   gravados juntos — ou nada é gravado.
 * Depois do commit: notificação, evento de tempo real e revalidação das páginas (`afterResult`).
 */
import { audited, withAudit, type AuditContext, type Prisma, type PrismaClient } from '@nova/db';
import { applyResult, type MatchNode, type MatchResult, type MatchResultInput, type Rule, type StageState, type StageStructure } from '@nova/engine';
import type { ResultEntryInput, SubmitResultInput } from '@nova/schemas';
import type { AppContext } from '../context';
import { badRequest, conflict, notFound } from '../errors';
import { notify, publish } from '../notify';
import { revalidateTournaments } from '../revalidate';
import { namesFor } from './bracket';
import { dropCountOf, entryPoints } from './points';
import { engine, projectRun, readRun, snapshotOf, type StageRun } from './run';
import { persistStandings, standingsKey, type StandingsStage } from './standings';

type Tx = Prisma.TransactionClient;
type Db = PrismaClient | Tx;

export type ResultSource = 'STAFF' | 'SUBMISSION' | 'DISPUTE' | 'IMPORT';
export type ResultEventType = 'ENTERED' | 'CORRECTED' | 'WALKOVER' | 'REVERTED';

/** Fase com tudo o que o lançamento precisa, lida dentro da transação depois da trava. */
const lockedStageInclude = {
  tournament: { include: { game: { select: { extraStatFields: true } } } },
  scoringModel: { select: { rules: true, matchType: true } },
} as const;
export type LockedStage = Prisma.StageGetPayload<{ include: typeof lockedStageInclude }>;

/** Trava a fase (uma operação de chave por vez) e devolve a fase atualizada. */
export async function lockStage(tx: Tx, stageId: string): Promise<LockedStage> {
  await tx.$queryRaw`SELECT id FROM stages WHERE id = ${stageId}::uuid FOR UPDATE`;
  return tx.stage.findUniqueOrThrow({ where: { id: stageId }, include: lockedStageInclude });
}

export const standingsStageOf = (stage: LockedStage & { updatedAt: Date }): StandingsStage => ({
  id: stage.id,
  tournamentId: stage.tournamentId,
  format: stage.format,
  tiebreakers: stage.tiebreakers,
  qualification: stage.qualification,
  updatedAt: stage.updatedAt,
  engineSnapshot: stage.engineSnapshot,
  confirmedAt: stage.confirmedAt,
  unlocked: stage.unlocked,
  scoringModel: stage.scoringModel,
});

/** Grava o retrato novo, a projeção (com pontos) e a tabela `standings`, na transação. */
export async function writeRun(tx: Tx, stage: LockedStage, previous: StageRun, next: Pick<StageRun, 'structure' | 'state'>): Promise<StageRun> {
  const updated = await tx.stage.update({ where: { id: stage.id }, data: { engineSnapshot: snapshotOf(next.structure, next.state) }, select: { updatedAt: true } });
  const rules = (stage.scoringModel.rules ?? []) as Rule[];
  await projectRun(tx, stage.id, next, { previous, rules });
  const run: StageRun = { ...previous, structure: next.structure, state: next.state };
  await persistStandings(tx, standingsStageOf({ ...stage, updatedAt: updated.updatedAt, engineSnapshot: null }), run);
  return run;
}

// ── Rótulos e resumos (mesmos textos da API simulada) ────────────────
type Names = Map<string, { name: string }>;

export function matchLabelOf(node: MatchNode, names: Names, stage: { name: string }, groupName: string | null): string {
  const list = node.slots.map((s) => (s.entrantId ? (names.get(s.entrantId)?.name ?? 'Inscrito') : 'A definir'));
  return node.kind === 'LOBBY' ? `${stage.name} · ${groupName ? `${groupName} · ` : ''}${node.roundLabel}` : `${node.roundLabel}: ${list.join(' x ')}`;
}

export function resultSummary(node: MatchNode, result: MatchResult | undefined, names: Names): string {
  const name = (id: string) => names.get(id)?.name ?? 'Inscrito';
  if (!result) return 'Resultado removido';
  if (result.voided) return 'Resultado anulado';
  if (node.kind === 'LOBBY') {
    const booyah = result.entries.find((e) => e.placement === 1 && !e.absent);
    return `${booyah ? name(booyah.entrantId) : '—'} levou o Booyah`;
  }
  return node.slots
    .filter((s) => s.entrantId)
    .map((s) => `${name(s.entrantId as string)} ${result.entries.find((e) => e.entrantId === s.entrantId)?.score ?? 0}`)
    .join(' x ');
}

const groupNameOf = (structure: StageStructure, node: MatchNode) => structure.groups.find((g) => g.id === node.groupId)?.name ?? null;

// ── Histórico (issue #86) ────────────────────────────────────────────
export interface ResultEventInput {
  matchId: string;
  actorId: string | null;
  type: ResultEventType;
  before: MatchResult | null | undefined;
  after: MatchResult | null | undefined;
  summary: string;
  reason?: string | null;
  source?: ResultSource | 'SYSTEM' | 'WITHDRAWAL';
  at?: Date;
}

/** Evento do histórico do resultado (somente inserção: o banco recusa UPDATE e DELETE). */
export async function recordResultEvent(tx: Tx, e: ResultEventInput): Promise<void> {
  await tx.resultEvent.create({
    data: {
      matchId: e.matchId,
      actorId: e.actorId,
      type: e.type,
      before: (e.before ? { result: e.before } : { result: null }) as Prisma.InputJsonValue,
      after: { result: e.after ?? null, summary: e.summary, origem: e.source ?? 'STAFF' } as unknown as Prisma.InputJsonValue,
      reason: e.reason ?? null,
      ...(e.at ? { createdAt: e.at } : {}),
    },
  });
}

/**
 * Eventos das partidas que mudaram entre dois estados (desistência, desclassificação): W.O. novo, resultado anulado
 * ou alterado. Assim todo resultado tem histórico, inclusive os que o motor decide sozinho.
 */
export async function recordStateChanges(tx: Tx, stageId: string, structure: StageStructure, before: StageState, after: StageState, ctx: { actorId: string | null; reason: string | null; names: Names; source: ResultEventInput['source'] }): Promise<void> {
  const ids = await tx.match.findMany({ where: { stageId }, select: { id: true, nodeId: true } });
  const byNode = new Map(ids.map((m) => [m.nodeId, m.id]));
  for (const node of structure.matches) {
    const prev = before.results[node.id];
    const next = after.results[node.id];
    if (JSON.stringify(prev ?? null) === JSON.stringify(next ?? null)) continue;
    const matchId = byNode.get(node.id);
    if (!matchId) continue;
    const type: ResultEventType = next?.voided || !next ? 'REVERTED' : next.walkover && !prev ? 'WALKOVER' : prev ? 'CORRECTED' : 'ENTERED';
    await recordResultEvent(tx, { matchId, actorId: ctx.actorId, type, before: prev, after: next, summary: resultSummary(node, next, ctx.names), reason: ctx.reason, source: ctx.source });
  }
}

// ── Provas (Vercel Blob) ─────────────────────────────────────────────
/**
 * Associa as provas a um recurso (`MATCH` ou `DISPUTE`): só arquivo de prova confirmado por `/uploads/complete`,
 * de quem está enviando — ou já associado a este mesmo recurso (ex.: a disputa reaproveita o print do envio).
 * Assim a limpeza diária não apaga a prova como órfã, e só as partes e a organização conseguem abri-la.
 */
export async function attachEvidence(tx: Tx, input: { urls: string[]; ownerId: string; type: 'MATCH' | 'DISPUTE'; id: string; now: Date; reuse?: { type: 'MATCH' | 'DISPUTE'; id: string }[] }): Promise<void> {
  for (const url of input.urls) {
    const privateId = /^\/api\/v1\/files\/([0-9a-f-]{36})$/i.exec(url)?.[1];
    const where = privateId ? { id: privateId } : { blobUrl: url };
    const { count } = await tx.upload.updateMany({ where: { ...where, ownerId: input.ownerId, purpose: 'evidence', attachedAt: null }, data: { attachedType: input.type, attachedId: input.id, attachedAt: input.now } });
    if (count > 0) continue;
    const reusable = [{ type: input.type, id: input.id }, ...(input.reuse ?? [])];
    const already = await tx.upload.count({ where: { ...where, purpose: 'evidence', OR: reusable.map((r) => ({ attachedType: r.type, attachedId: r.id })) } });
    if (already === 0) throw badRequest('Uma das provas não foi enviada por você ou já foi usada. Envie a imagem de novo.', 'UPLOAD_NOT_FOUND');
  }
}

// ── Lançamento ───────────────────────────────────────────────────────
export interface ApplyResultOptions {
  source: ResultSource;
  audit: AuditContext & { actorId: string };
  now: Date;
  /** Roda logo depois da trava, antes das regras (ex.: reservar o envio que está sendo aprovado). */
  guard?: (tx: Tx) => Promise<void>;
  /** Roda no fim, na mesma transação (ex.: fechar a disputa). */
  extra?: (tx: Tx) => Promise<void>;
  /** Provas que já pertencem a outro recurso e podem ir para a partida (o print do envio contestado). */
  reuseEvidence?: { type: 'MATCH' | 'DISPUTE'; id: string }[];
}

export interface AppliedResult {
  matchId: string;
  stageId: string;
  tournament: { id: string; slug: string; name: string };
  corrected: boolean;
  label: string;
  registrationIds: string[];
  breakdown: { registrationId: string; points: number; breakdown: { label: string; points: number }[] }[];
}

/** Vencedor pelo campo de desempate do jogo (RN-14), quando o placar do duelo empata. */
export function tiebreakWinner(entries: ResultEntryInput[], extraStatFields: unknown): string | undefined {
  const [a, b] = entries;
  if (!a || !b || (a.score ?? 0) !== (b.score ?? 0)) return undefined;
  const tiebreak = (Array.isArray(extraStatFields) ? (extraStatFields as { key: string; when?: string }[]) : []).find((f) => f.when === 'tiebreak');
  if (!tiebreak) return undefined;
  const av = a.stats?.[tiebreak.key] ?? 0;
  const bv = b.stats?.[tiebreak.key] ?? 0;
  return av === bv ? undefined : av > bv ? a.registrationId : b.registrationId;
}

export function toEngineInput(nodeId: string, entries: ResultEntryInput[], winnerId: string | null | undefined): MatchResultInput {
  return {
    matchId: nodeId,
    entries: entries.map((e) => ({
      entrantId: e.registrationId,
      ...(e.score !== undefined ? { score: e.score } : {}),
      ...(e.placement !== undefined ? { placement: e.placement } : {}),
      ...(e.kills !== undefined ? { kills: e.kills } : {}),
      ...(e.absent ? { absent: true } : {}),
      ...(e.stats ? { stats: e.stats } : {}),
    })),
    ...(winnerId !== undefined && winnerId !== null ? { winnerId } : {}),
  };
}

/** Usuários de cada inscrição: o jogador solo ou os membros confirmados do squad. */
export async function usersOfRegistrations(db: Db, ids: string[]): Promise<Map<string, string[]>> {
  if (ids.length === 0) return new Map();
  const rows = await db.registration.findMany({ where: { id: { in: ids } }, select: { id: true, userId: true, members: { where: { confirmedAt: { not: null } }, select: { userId: true } } } });
  return new Map(rows.map((r) => [r.id, r.userId ? [r.userId] : r.members.map((m) => m.userId)]));
}

export async function applyMatchResult(db: PrismaClient, matchId: string, input: SubmitResultInput, opts: ApplyResultOptions): Promise<AppliedResult> {
  const head = /^[0-9a-f-]{36}$/i.test(matchId) ? await db.match.findUnique({ where: { id: matchId }, select: { stageId: true } }) : null;
  if (!head) throw notFound('Partida');

  return withAudit(db, { ...opts.audit, reason: input.correctionReason ?? opts.audit.reason ?? null }, async (tx) => {
    const stage = await lockStage(tx, head.stageId);
    await opts.guard?.(tx);
    const match = await tx.match.findUniqueOrThrow({ where: { id: matchId }, select: { id: true, nodeId: true, evidenceUrls: true } });
    const run = readRun(stage);
    const node = run?.structure.matches.find((m) => m.id === match.nodeId);
    if (!run?.confirmed || !node) throw notFound('Partida');
    const t = stage.tournament;
    if (t.status === 'PAUSED') throw conflict('O campeonato está pausado. Retome para lançar resultados.', 'TOURNAMENT_PAUSED');
    if (t.status !== 'IN_PROGRESS' && t.status !== 'FINISHED') throw conflict('O campeonato não está em andamento.', 'TOURNAMENT_NOT_RUNNING');
    const previous = run.state.results[node.id];
    if (previous && !input.correctionReason) throw badRequest('Informe o motivo da correção.', 'CORRECTION_REASON_REQUIRED', { correctionReason: 'Informe o motivo da correção' });

    const slotIds = new Set(node.slots.map((s) => s.entrantId).filter((x): x is string => x !== null));
    for (const e of input.entries) if (!slotIds.has(e.registrationId)) throw badRequest('Há um participante que não é desta partida.', 'INVALID_RESULT');

    // RN-14: empate em mata-mata só com o campo de desempate do jogo ou o vencedor informado.
    let winnerId = input.winnerRegistrationId;
    if (node.kind === 'DUEL' && (winnerId === undefined || winnerId === null) && input.entries.length === 2) winnerId = tiebreakWinner(input.entries, t.game.extraStatFields) ?? winnerId;
    const snapshot = engine(() => applyResult(run.structure, run.state, toEngineInput(node.id, input.entries, winnerId)));

    // Kills por jogador (RN-03): a soma precisa bater com as kills da equipe, e o jogador precisa ser da equipe.
    const users = await usersOfRegistrations(tx, [...slotIds]);
    const playerKills: { registrationId: string; userId: string; kills: number }[] = [];
    for (const e of input.entries) {
      if (!e.playerKills) continue;
      const sum = Object.values(e.playerKills).reduce((s, k) => s + k, 0);
      if (e.kills !== undefined && sum !== e.kills) throw badRequest('A soma das kills por jogador precisa ser igual às kills da equipe.', 'PLAYER_KILLS_MISMATCH');
      const members = users.get(e.registrationId) ?? [];
      for (const [userId, kills] of Object.entries(e.playerKills)) {
        if (!members.includes(userId)) throw badRequest('Há um jogador que não faz parte desta equipe.', 'INVALID_RESULT');
        playerKills.push({ registrationId: e.registrationId, userId, kills });
      }
    }

    const next = await writeRun(tx, stage, run, snapshot);
    if (input.evidenceUrls.length > 0) await attachEvidence(tx, { urls: input.evidenceUrls, ownerId: opts.audit.actorId, type: 'MATCH', id: match.id, now: opts.now, reuse: opts.reuseEvidence });
    await tx.match.update({ where: { id: match.id }, data: { status: snapshot.state.results[node.id]?.walkover ? 'WALKOVER' : 'VALIDATED', ...(input.evidenceUrls.length > 0 ? { evidenceUrls: input.evidenceUrls } : {}) } });

    // Kills por jogador: substituem as do lançamento anterior desta partida.
    const parts = await tx.matchParticipant.findMany({ where: { matchId: match.id }, select: { id: true, registrationId: true } });
    await tx.playerStat.deleteMany({ where: { matchParticipantId: { in: parts.map((p) => p.id) } } });
    const partOf = new Map(parts.map((p) => [p.registrationId, p.id]));
    if (playerKills.length) {
      await tx.playerStat.createMany({ data: playerKills.flatMap((pk) => (partOf.get(pk.registrationId) ? [{ matchParticipantId: partOf.get(pk.registrationId) as string, userId: pk.userId, stats: { kills: pk.kills } }] : [])) });
    }

    const result = snapshot.state.results[node.id];
    const names = await namesFor(tx, stage.tournamentId);
    const label = matchLabelOf(node, names, stage, groupNameOf(run.structure, node));
    const summary = resultSummary(node, result, names);
    await recordResultEvent(tx, { matchId: match.id, actorId: opts.audit.actorId, type: previous ? 'CORRECTED' : 'ENTERED', before: previous, after: result, summary, reason: input.correctionReason ?? null, source: opts.source });
    await audited(tx, {
      action: previous ? 'RESULT_CORRECTED' : 'RESULT_ENTERED',
      entityType: 'Match',
      entityId: match.id,
      entityLabel: label,
      tournamentId: stage.tournamentId,
      before: previous ? { entries: previous.entries, winnerId: previous.winnerId } : null,
      after: { entries: result?.entries, winnerId: result?.winnerId ?? null, origem: opts.source },
      reason: input.correctionReason ?? null,
    });
    await opts.extra?.(tx);

    const rules = (stage.scoringModel.rules ?? []) as Rule[];
    const dropCount = dropCountOf(next.structure, node);
    const breakdown = node.slots
      .filter((s): s is { entrantId: string } => s.entrantId !== null)
      .map((s) => {
        const entry = result?.entries.find((e) => e.entrantId === s.entrantId);
        const computed = !entry || !result || entry.absent ? { total: 0, breakdown: [] } : entryPoints(entry, node, result, rules, dropCount);
        return { registrationId: s.entrantId, points: computed.total, breakdown: computed.breakdown };
      });
    return { matchId: match.id, stageId: stage.id, tournament: { id: t.id, slug: t.slug, name: t.name }, corrected: Boolean(previous), label, registrationIds: [...slotIds], breakdown };
  });
}

/** Depois do commit: avisa os participantes, publica no tempo real e revalida as páginas. Nunca lança. */
export async function afterResult(c: AppContext, applied: AppliedResult, status: string): Promise<void> {
  const db = c.get('deps').db();
  await c.get('deps').cache(c.get('env')).del(standingsKey(applied.stageId)).catch(() => undefined);
  const users = await usersOfRegistrations(db, applied.registrationIds).catch(() => new Map<string, string[]>());
  await notify(c, [...users.values()].flat(), {
    type: 'RESULT_POSTED',
    title: applied.corrected ? 'Resultado corrigido' : 'Resultado lançado',
    body: `${applied.label} · ${applied.tournament.name}`,
    link: `/c/${applied.tournament.slug}?aba=partidas`,
  });
  await publishStage(c, applied.tournament.id, applied.stageId, { matchId: applied.matchId, status });
  revalidateTournaments(c);
}

/** Eventos de tempo real de uma fase que mudou (chave e tabela), e da partida, quando houver. */
export async function publishStage(c: AppContext, tournamentId: string, stageId: string, match?: { matchId: string; status: string }): Promise<void> {
  if (match) await publish(c, `tournament:${tournamentId}`, { type: 'match.updated', matchId: match.matchId, stageId, status: match.status });
  await publish(c, `tournament:${tournamentId}`, { type: 'bracket.updated', stageId });
  await publish(c, `tournament:${tournamentId}`, { type: 'standings.updated', stageId });
}

