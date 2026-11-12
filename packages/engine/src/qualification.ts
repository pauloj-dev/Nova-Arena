import { EngineError } from './errors';
import { generateStage } from './generate';
import { isEliminationFormat, isStageComplete, swapEntrants } from './operations';
import { computeStandings } from './standings';
import type {
  AdvanceStageInput,
  Entrant,
  QualificationResult,
  QualificationRule,
  QualifiedEntrant,
  StagePreview,
  StageStructure,
  StandingRow,
  Standings,
} from './types';

const invalid = (message: string): EngineError => new EngineError('INVALID_QUALIFICATION', message);

function count(value: number | undefined, label: string, min: number): number {
  if (value === undefined && min === 0) return 0;
  if (value === undefined || !Number.isInteger(value) || value < min) {
    throw invalid(`${label} precisa ser um número inteiro a partir de ${min}.`);
  }
  return value;
}

/**
 * Aplica a regra de classificação sobre a tabela.
 *
 * - `TOP_N_PER_GROUP`: os N primeiros de cada grupo.
 * - `TOP_N_OVERALL`: os N primeiros da tabela geral.
 * - `WINNERS`: quem não foi eliminado (mata-mata) ou o 1º de cada grupo.
 * - `repechage: n`: completa com os n melhores entre os que ficaram de fora.
 *
 * Quem desistiu ou foi desclassificado não se classifica. A lista sai na ordem
 * das seeds da próxima fase: primeiros colocados, depois segundos, e por fim a
 * repescagem.
 */
export function applyQualification(standings: Standings, rule: QualificationRule): QualificationResult {
  const overallIndex = new Map(standings.overall.map((row, index) => [row.entrantId, index]));
  const groupRank = new Map<string, number>();
  for (const group of standings.groups) {
    group.rows.forEach((row) => groupRank.set(row.entrantId, row.position));
  }
  const byOverall = (a: StandingRow, b: StandingRow): number =>
    (overallIndex.get(a.entrantId) as number) - (overallIndex.get(b.entrantId) as number);
  const isActive = (row: StandingRow): boolean => row.status === 'ACTIVE';

  let direct: StandingRow[];
  switch (rule?.type) {
    case 'TOP_N_PER_GROUP': {
      const n = count(rule.n, 'O número de classificados por grupo', 1);
      const tiers: StandingRow[][] = [];
      for (const group of standings.groups) {
        group.rows
          .filter(isActive)
          .slice(0, n)
          .forEach((row, tier) => {
            (tiers[tier] ??= []).push(row);
          });
      }
      direct = tiers.flatMap((tier) => tier.sort(byOverall));
      break;
    }
    case 'TOP_N_OVERALL': {
      const n = count(rule.n, 'O número de classificados', 1);
      direct = standings.overall.filter(isActive).slice(0, n);
      break;
    }
    case 'WINNERS': {
      direct = isEliminationFormat(standings.format)
        ? standings.overall.filter((row) => isActive(row) && !row.eliminated)
        : standings.groups.flatMap((group) => group.rows.filter(isActive).slice(0, 1)).sort(byOverall);
      break;
    }
    default:
      throw invalid('Regra de classificação inválida.');
  }

  const chosen = new Set(direct.map((row) => row.entrantId));
  const repechage = standings.overall
    .filter((row) => isActive(row) && !chosen.has(row.entrantId))
    .slice(0, count(rule.repechage, 'A repescagem', 0));
  for (const row of repechage) chosen.add(row.entrantId);

  const toQualified = (row: StandingRow, via: QualifiedEntrant['via'], index: number): QualifiedEntrant => ({
    entrantId: row.entrantId,
    name: row.name,
    groupId: row.groupId,
    groupPosition: groupRank.get(row.entrantId) as number,
    overallPosition: (overallIndex.get(row.entrantId) as number) + 1,
    via,
    seed: index + 1,
  });

  return {
    qualified: [
      ...direct.map((row, index) => toQualified(row, 'DIRECT', index)),
      ...repechage.map((row, index) => toQualified(row, 'REPECHAGE', direct.length + index)),
    ],
    eliminated: standings.overall.filter((row) => !chosen.has(row.entrantId)).map((row) => row.entrantId),
  };
}

/** Troca adversários da 1ª rodada para que dois classificados do mesmo grupo não se enfrentem de cara. */
function avoidSameGroupClashes(structure: StageStructure, groupOf: ReadonlyMap<string, string | null>): StageStructure {
  if (!isEliminationFormat(structure.format) && structure.format !== 'SWISS') return structure;
  let current = structure;
  const sameGroup = (a: string, b: string): boolean => {
    const group = groupOf.get(a);
    return group !== null && group !== undefined && group === groupOf.get(b);
  };
  const firstRound = (): Array<[string, string]> =>
    current.matches
      .filter((match) => match.round === 1 && match.kind === 'DUEL' && match.slots.length === 2)
      .filter((match) => match.bracket === null || match.bracket === 'WINNERS')
      .map((match) => match.slots.map((slot) => slot.entrantId))
      .filter((ids): ids is [string, string] => ids[0] != null && ids[1] != null);
  const seedOf = (id: string): number => current.entrants.findIndex((entrant) => entrant.id === id);

  const pairs = firstRound().length;
  for (let pass = 0; pass < pairs; pass++) {
    const round = firstRound();
    const clash = round.find(([a, b]) => sameGroup(a, b));
    if (!clash) break;
    const [a, b] = clash;
    const candidates = round
      .filter(([c, d]) => d !== b && !sameGroup(a, d) && !sameGroup(c, b))
      .map(([, d]) => d)
      .sort((x, y) => Math.abs(seedOf(x) - seedOf(b)) - Math.abs(seedOf(y) - seedOf(b)));
    const partner = candidates[0];
    if (partner === undefined) break;
    current = swapEntrants(current, b, partner);
  }
  return current;
}

/**
 * Fecha a fase e monta a prévia da próxima: exige todas as partidas
 * concluídas, calcula a tabela, aplica a regra de classificação e gera a chave
 * seguinte com seeding pela classificação, evitando que 1º e 2º do mesmo grupo
 * se enfrentem na primeira rodada. Nada é gravado: o organizador confirma.
 */
export function advanceStage(input: AdvanceStageInput): StagePreview {
  const { structure, state, next } = input;
  if (!isStageComplete(structure, state)) {
    throw new EngineError('STAGE_INCOMPLETE', 'Conclua todas as partidas da fase antes de avançar.');
  }
  const standings = computeStandings(structure, state, input.standings);
  const { qualified, eliminated } = applyQualification(standings, input.qualification);
  if (qualified.length < 2) {
    throw invalid('A regra de classificação precisa levar ao menos 2 participantes para a próxima fase.');
  }

  const ratings = new Map(structure.entrants.map((entrant) => [entrant.id, entrant.rating]));
  const entrants = qualified.map((q): Entrant => {
    const entrant: Entrant = { id: q.entrantId, name: q.name, seed: q.seed };
    const rating = ratings.get(q.entrantId);
    if (rating !== undefined) entrant.rating = rating;
    return entrant;
  });
  const seeding = next.seeding ?? 'RANKED';
  const generated = generateStage({
    format: next.format,
    entrants,
    config: next.config,
    seeding,
    seed: next.seed ?? (seeding === 'RANDOM' ? undefined : structure.seedUsed),
  });

  const groupOf = new Map(qualified.map((q) => [q.entrantId, q.groupId]));
  return { standings, qualified, eliminated, next: avoidSameGroupClashes(generated, groupOf) };
}
