import { EngineError } from './errors';
import { buildDoubleElim, buildSingleElim } from './formats/elimination';
import { buildBattleRoyale, buildGroups, buildRoundRobin } from './formats/pools';
import { buildSwissFirstRound, maxSwissRounds } from './formats/swiss';
import { randomSeed } from './prng';
import { seedEntrants } from './seeding';
import type { GenerateStageInput, MatchNode, StageConfig, StageFormat, StageGroup, StageStructure } from './types';

export const STAGE_FORMATS: readonly StageFormat[] = [
  'SINGLE_ELIM',
  'DOUBLE_ELIM',
  'GROUPS',
  'ROUND_ROBIN',
  'SWISS',
  'BATTLE_ROYALE',
  'TEAM_VS_TEAM',
];

/** Tamanho padrão da sala Battle Royale (ADR-0001, Q1). */
export const DEFAULT_LOBBY_SIZE = 12;

const invalid = (message: string): EngineError => new EngineError('INVALID_CONFIG', message);

function positiveInt(value: number | undefined, fallback: number, message: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) throw invalid(message);
  return value;
}

/**
 * Gera a chave de uma fase. A saída tem o mesmo formato nos 7 formatos e é
 * determinística: mesma entrada (e mesma seed) = mesma chave, com os mesmos ids.
 */
export function generateStage(input: GenerateStageInput): StageStructure {
  const { format, seeding } = input;
  if (!STAGE_FORMATS.includes(format)) throw invalid('Formato de fase inválido.');
  const config = input.config ?? {};
  const seedUsed = input.seed ?? (seeding === 'RANDOM' ? randomSeed() : '');
  const entrants = seedEntrants(input.entrants, seeding, seedUsed);
  const ids = entrants.map((entrant) => entrant.id);
  const count = entrants.length;

  const bestOf = config.bestOf ?? 1;
  if (![1, 3, 5, 7].includes(bestOf)) throw invalid('A série precisa ser melhor de 1, 3, 5 ou 7.');
  const drops = positiveInt(config.drops, 1, 'O número de quedas precisa ser um inteiro a partir de 1.');
  const dropMultipliers = config.dropMultipliers ?? [];
  if (dropMultipliers.some((m) => typeof m !== 'number' || !Number.isFinite(m) || m <= 0)) {
    throw invalid('Os multiplicadores das quedas precisam ser maiores que zero.');
  }

  let resolved: StageConfig;
  let groups: StageGroup[] = [];
  let matches: MatchNode[];
  let rounds: number;

  switch (format) {
    case 'SINGLE_ELIM':
    case 'TEAM_VS_TEAM': {
      const thirdPlace = config.thirdPlace ?? false;
      const stopAtRemaining = config.stopAtRemaining ?? 1;
      ({ matches, rounds } = buildSingleElim(entrants, { bestOf, thirdPlace, stopAtRemaining }));
      resolved = { bestOf, thirdPlace, stopAtRemaining };
      break;
    }
    case 'DOUBLE_ELIM': {
      const grandFinalReset = config.grandFinalReset ?? true;
      ({ matches, rounds } = buildDoubleElim(entrants, { bestOf, grandFinalReset }));
      resolved = { bestOf, grandFinalReset };
      break;
    }
    case 'ROUND_ROBIN': {
      const doubleRound = config.doubleRound ?? false;
      ({ matches, rounds } = buildRoundRobin(ids, { bestOf, doubleRound, groupId: null, idPrefix: 'rr' }));
      resolved = { bestOf, doubleRound };
      break;
    }
    case 'GROUPS': {
      const groupMode = config.groupMode ?? 'ROUND_ROBIN';
      if (groupMode !== 'ROUND_ROBIN' && groupMode !== 'BATTLE_ROYALE') throw invalid('Modo de grupo inválido.');
      const fallbackSize = groupMode === 'BATTLE_ROYALE' ? DEFAULT_LOBBY_SIZE : 4;
      const groupSize = positiveInt(config.groupSize, fallbackSize, 'O tamanho do grupo precisa ser um inteiro a partir de 2.');
      if (groupSize < 2) throw invalid('O tamanho do grupo precisa ser um inteiro a partir de 2.');
      const groupCount = positiveInt(
        config.groupCount,
        Math.max(1, Math.min(Math.ceil(count / groupSize), Math.floor(count / 2))),
        'O número de grupos precisa ser um inteiro a partir de 1.',
      );
      const doubleRound = config.doubleRound ?? false;
      ({ groups, matches, rounds } = buildGroups(entrants, { groupCount, groupMode, bestOf, doubleRound, drops, dropMultipliers }));
      resolved =
        groupMode === 'BATTLE_ROYALE'
          ? { groupCount, groupMode, drops, dropMultipliers, killsPerPlayer: config.killsPerPlayer ?? false }
          : { groupCount, groupMode, bestOf, doubleRound };
      break;
    }
    case 'SWISS': {
      const max = maxSwissRounds(count);
      rounds = positiveInt(
        config.rounds,
        Math.min(max, Math.max(1, Math.ceil(Math.log2(count)))),
        'O número de rodadas precisa ser um inteiro a partir de 1.',
      );
      if (rounds > max) {
        throw invalid(`Com ${count} participantes o suíço comporta no máximo ${max} rodadas sem repetir confronto.`);
      }
      matches = buildSwissFirstRound(ids, bestOf);
      resolved = { bestOf, rounds };
      break;
    }
    case 'BATTLE_ROYALE': {
      const lobbySize = positiveInt(config.lobbySize, DEFAULT_LOBBY_SIZE, 'O tamanho da sala precisa ser um inteiro a partir de 2.');
      if (lobbySize < 2) throw invalid('O tamanho da sala precisa ser um inteiro a partir de 2.');
      if (lobbySize === 2 && count % 2 === 1) {
        throw invalid('Com salas de 2, o número de participantes precisa ser par.');
      }
      ({ groups, matches, rounds } = buildBattleRoyale(entrants, { lobbySize, drops, dropMultipliers }));
      resolved = { lobbySize, drops, dropMultipliers, killsPerPlayer: config.killsPerPlayer ?? false };
      break;
    }
  }

  if (config.walkoverScore !== undefined) {
    if (!Number.isFinite(config.walkoverScore) || config.walkoverScore < 0) {
      throw invalid('O placar de W.O. precisa ser um número a partir de 0.');
    }
    resolved.walkoverScore = config.walkoverScore;
  }

  return { format, seedUsed, seeding, config: resolved, entrants, groups, matches, rounds };
}
