/**
 * Retrato do motor por fase (ADR-0002, issue #82): leitura, gravação e projeção nas tabelas de consulta.
 */
import type { Prisma, PrismaClient } from '@nova/db';
import { createStageState, EngineError, type StageConfig as EngineConfig, type QualificationRule, type Rule, type StageState, type StageStructure } from '@nova/engine';
import type { Stage } from '@nova/schemas';
import { HttpProblem } from '../errors';
import { pointsOf } from './points';

type Db = PrismaClient | Prisma.TransactionClient;

export interface StageRun {
  structure: StageStructure;
  state: StageState;
  /** Falso enquanto a chave é só uma prévia da organização. */
  confirmed: boolean;
  /** RN-07: Admin destravou depois da 1ª partida concluída. */
  unlocked: boolean;
}

/** Versão do formato do retrato: mudou a estrutura do motor, sobe e migra. */
const SNAPSHOT_VERSION = 1;

interface Snapshot {
  v: number;
  structure: StageStructure;
  state: StageState;
}

export function readRun(stage: { engineSnapshot: unknown; confirmedAt: Date | null; unlocked: boolean }): StageRun | null {
  const snap = stage.engineSnapshot as Snapshot | null;
  if (!snap || typeof snap !== 'object' || !snap.structure) return null;
  return { structure: snap.structure, state: snap.state ?? createStageState(), confirmed: stage.confirmedAt !== null, unlocked: stage.unlocked };
}

export function snapshotOf(structure: StageStructure, state: StageState): Prisma.InputJsonValue {
  return { v: SNAPSHOT_VERSION, structure, state } as unknown as Prisma.InputJsonValue;
}

/** RN-07: depois da 1ª partida concluída (resultado que vale), a chave trava até um Admin destravar. */
export function isLocked(run: StageRun): boolean {
  if (!run.confirmed || run.unlocked) return false;
  return Object.values(run.state.results).some((r) => !r.voided);
}

/** Erros de regra do motor viram 400/409 com a mensagem em pt-BR que ele já traz. */
export function engine<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof EngineError) {
      const status = ['RESULT_LOCKED', 'STAGE_STARTED', 'STAGE_INCOMPLETE'].includes(error.code) ? 409 : 400;
      throw new HttpProblem(status, error.message, error.code);
    }
    throw error;
  }
}

/** Configuração da fase (contrato) → configuração do motor. Mesma conversão da API simulada. */
export function toEngineConfig(stage: Pick<Stage, 'format' | 'config' | 'qualification'>): EngineConfig {
  const c = stage.config;
  const config: EngineConfig = { bestOf: c.bestOf, killsPerPlayer: c.killsPerPlayer };
  const drops = (): Pick<EngineConfig, 'drops' | 'dropMultipliers'> =>
    c.lastDropMultiplier > 1 ? { drops: c.drops, dropMultipliers: Array.from({ length: c.drops }, (_, i) => (i === c.drops - 1 ? c.lastDropMultiplier : 1)) } : { drops: c.drops };
  switch (stage.format) {
    case 'SINGLE_ELIM':
    case 'TEAM_VS_TEAM':
      config.thirdPlace = c.thirdPlace;
      // "Vencedores" com N > 1: a chave para quando restarem N (ex.: mata-mata até sobrarem 2 finalistas).
      if (stage.qualification?.type === 'WINNERS' && stage.qualification.n > 1) {
        config.stopAtRemaining = stage.qualification.n;
        config.thirdPlace = false;
      }
      break;
    case 'DOUBLE_ELIM':
      config.grandFinalReset = c.grandFinalReset;
      break;
    case 'GROUPS':
      config.groupCount = c.groupCount;
      config.groupMode = c.groupMode === 'BATTLE_ROYALE' ? 'BATTLE_ROYALE' : 'ROUND_ROBIN';
      config.doubleRound = c.doubleRound;
      if (c.groupMode === 'BATTLE_ROYALE') Object.assign(config, drops());
      break;
    case 'ROUND_ROBIN':
      config.doubleRound = c.doubleRound;
      break;
    case 'SWISS':
      config.rounds = c.rounds;
      break;
    case 'BATTLE_ROYALE':
      config.lobbySize = c.lobbySize;
      Object.assign(config, drops());
      break;
  }
  return config;
}

export function toEngineQualification(stage: Pick<Stage, 'qualification'>): QualificationRule | null {
  const q = stage.qualification;
  if (!q) return null;
  const repechage = q.repechage > 0 ? { repechage: q.repechage } : {};
  if (q.type === 'WINNERS') return { type: 'WINNERS', ...repechage };
  return { type: q.type, n: q.n, ...repechage };
}

export interface ProjectOptions {
  /** Retrato anterior: só as partidas que mudaram (vagas ou resultado) são regravadas. Sem ele, regrava tudo. */
  previous?: Pick<StageRun, 'structure' | 'state'> | null;
  /** Regras do modelo de pontuação: com elas, os pontos de cada participação vão para a projeção (RN-01). */
  rules?: Rule[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Projeta o retrato nas tabelas de consulta. Grupos e partidas são casados pela ordem e pelo `nodeId` (únicos na
 * fase): repetir não duplica nada. Horário, sala, provas e check-in das partidas que continuam ficam intactos.
 *
 * Com `previous`, só regrava as partidas que mudaram — um resultado mexe em poucas partidas, e a tabela nova fica
 * pronta em menos de 2 s mesmo em fase grande (issue #87). As participações são atualizadas no lugar, então as
 * estatísticas por jogador (`player_stats`) das partidas com resultado continuam lá.
 */
export async function projectRun(tx: Prisma.TransactionClient, stageId: string, run: Pick<StageRun, 'structure' | 'state'>, opts: ProjectOptions = {}): Promise<void> {
  const { structure, state } = run;
  const previous = opts.previous ?? null;

  // Grupos (GROUPS) e salas (BATTLE_ROYALE).
  const groupsChanged = !previous || !same(previous.structure.groups, structure.groups);
  const groupIds = new Map<string, string>();
  if (groupsChanged) {
    const keepGroups: string[] = [];
    for (const [index, g] of structure.groups.entries()) {
      const row = await tx.group.upsert({ where: { stageId_order: { stageId, order: index + 1 } }, create: { stageId, order: index + 1, name: g.name }, update: { name: g.name } });
      groupIds.set(g.id, row.id);
      keepGroups.push(row.id);
      await tx.groupMember.deleteMany({ where: { groupId: row.id } });
      if (g.entrantIds.length) await tx.groupMember.createMany({ data: g.entrantIds.map((registrationId) => ({ groupId: row.id, registrationId })) });
    }
    await tx.group.deleteMany({ where: { stageId, id: { notIn: keepGroups } } });
  } else {
    const rows = await tx.group.findMany({ where: { stageId }, orderBy: { order: 'asc' }, select: { id: true } });
    structure.groups.forEach((g, i) => {
      const id = rows[i]?.id;
      if (id) groupIds.set(g.id, id);
    });
  }

  // Partidas que saíram da estrutura (regeração) somem — menos as que têm histórico de resultado, que é imutável.
  const nodeIds = structure.matches.map((m) => m.id);
  await tx.match.deleteMany({ where: { stageId, nodeId: { notIn: nodeIds }, resultEvents: { none: {} } } });
  const existing = await tx.match.findMany({ where: { stageId }, select: { id: true, nodeId: true } });
  const matchIds = new Map(existing.map((m) => [m.nodeId, m.id]));

  const before = new Map(previous?.structure.matches.map((m) => [m.id, m]) ?? []);
  const rewrite = structure.matches.filter(
    (node) => !previous || groupsChanged || !matchIds.has(node.id) || !same(before.get(node.id), node) || !same(previous.state.results[node.id], state.results[node.id]),
  );

  for (const node of rewrite) {
    const data = {
      groupId: node.groupId ? (groupIds.get(node.groupId) ?? null) : null,
      kind: node.kind,
      round: node.round,
      position: node.position,
      bracket: node.bracket,
      roundLabel: node.roundLabel,
      dropIndex: node.dropIndex ?? null,
      bestOf: node.bestOf,
      ifNecessary: node.ifNecessary ?? false,
      multiplier: node.multiplier ?? 1,
    };
    const row = await tx.match.upsert({ where: { stageId_nodeId: { stageId, nodeId: node.id } }, create: { stageId, nodeId: node.id, ...data }, update: data, select: { id: true } });
    matchIds.set(node.id, row.id);
  }
  for (const node of rewrite) {
    const id = matchIds.get(node.id) as string;
    await tx.match.update({
      where: { id },
      data: { nextMatchId: node.nextMatchId ? (matchIds.get(node.nextMatchId) ?? null) : null, loserNextMatchId: node.loserNextMatchId ? (matchIds.get(node.loserNextMatchId) ?? null) : null },
    });
    // Participantes conhecidos de cada partida, na ordem das vagas.
    const result = state.results[node.id];
    const known = node.slots.map((s, slot) => ({ slot, entrantId: s.entrantId })).filter((s): s is { slot: number; entrantId: string } => s.entrantId !== null);
    const rowOf = ({ slot, entrantId }: { slot: number; entrantId: string }) => {
      const entry = result?.entries.find((e) => e.entrantId === entrantId);
      const points = opts.rules ? pointsOf(structure, node, result, entrantId, opts.rules) : null;
      return {
        slot: slot + 1,
        placement: entry?.placement ?? null,
        kills: entry?.kills ?? null,
        score: entry?.score ?? null,
        isWinner: result ? (node.kind === 'LOBBY' ? entry?.placement === 1 : result.winnerId === entrantId) : null,
        absent: entry?.absent ?? false,
        walkover: result?.walkover ?? false,
        points: points ?? 0,
        rawStats: (entry?.stats ?? {}) as Prisma.InputJsonValue,
      };
    };
    await tx.matchParticipant.deleteMany({ where: { matchId: id, registrationId: { notIn: known.map((k) => k.entrantId) } } });
    if (!result) {
      // Sem resultado não há estatística por jogador a preservar: recria tudo de uma vez.
      await tx.matchParticipant.deleteMany({ where: { matchId: id } });
      if (known.length) await tx.matchParticipant.createMany({ data: known.map((k) => ({ matchId: id, registrationId: k.entrantId, ...rowOf(k) })) });
    } else {
      for (const k of known) {
        const data = rowOf(k);
        await tx.matchParticipant.upsert({ where: { matchId_registrationId: { matchId: id, registrationId: k.entrantId } }, create: { matchId: id, registrationId: k.entrantId, ...data }, update: data });
      }
    }
  }
}

/** Remove a projeção e o retrato (nova geração antes de confirmar). Partidas com histórico de resultado ficam. */
export async function clearRun(tx: Prisma.TransactionClient, stageId: string): Promise<void> {
  await tx.match.deleteMany({ where: { stageId, resultEvents: { none: {} } } });
  await tx.group.deleteMany({ where: { stageId } });
}

export async function stageWithTournament(db: Db, stageId: string) {
  return db.stage.findUnique({ where: { id: stageId }, include: { tournament: true, scoringModel: { select: { rules: true, matchType: true } } } });
}
