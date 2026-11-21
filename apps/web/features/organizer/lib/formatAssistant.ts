/**
 * Assistente de formato (issue 125, plano §11 melhoria 4): a partir do número de inscritos, do tempo disponível e do
 * jogo/modo, sugere de 2 a 4 formatos com as fases já montadas e a duração estimada. Puro: sem React nem DOM.
 *
 * As fases saem dos mesmos ajudantes do `StageBuilder` (`defaultStage`, `suggestedStages`) e só entram as que passam
 * na mesma validação entre fases (`validateStages`) usada no assistente de criação e na publicação.
 *
 * Premissas da estimativa (simples de propósito, mostradas na tela):
 * - partidas da mesma rodada acontecem ao mesmo tempo (cada confronto ou sala tem a sua sala no jogo);
 * - um jogo de duelo leva {@link DUEL_GAME_MINUTES} min (série melhor de 3 = até 3 jogos); uma queda BR leva
 *   {@link BR_DROP_MINUTES} min;
 * - entre uma rodada e outra há {@link ROUND_GAP_MINUTES} min (check-in, sala, lançamento) e entre fases,
 *   {@link STAGE_GAP_MINUTES} min.
 */
import {
  defaultStage,
  formatAvailability,
  maxSwissRounds,
  suggestedStages,
  validateStages,
  type Game,
  type GameMode,
  type StageFormat,
  type StageInput,
} from '@nova/schemas';

export const DUEL_GAME_MINUTES = 10;
export const BR_DROP_MINUTES = 25;
export const ROUND_GAP_MINUTES = 5;
export const STAGE_GAP_MINUTES = 15;

export interface FormatAssistantInput {
  entrants: number;
  /** Tempo disponível para jogar o campeonato inteiro, em minutos. */
  availableMinutes: number;
  game: Game | null;
  mode: GameMode | null;
  userId: string | null;
}

export interface FormatSuggestion {
  id: string;
  title: string;
  summary: string;
  stages: StageInput[];
  /** Rodadas jogadas uma depois da outra (o que decide a duração). */
  rounds: number;
  estimatedMinutes: number;
  fits: boolean;
  pros: string[];
  cons: string[];
}

const log2ceil = (n: number) => Math.max(1, Math.ceil(Math.log2(Math.max(2, n))));
const largestPowerOfTwo = (n: number) => (n < 1 ? 0 : 2 ** Math.floor(Math.log2(n)));

/** Rodadas em sequência de cada fase, para quem chega nela. */
export function stageRounds(stage: StageInput, entrants: number): number {
  const cfg = stage.config;
  switch (stage.format) {
    case 'SINGLE_ELIM':
    case 'TEAM_VS_TEAM':
      return log2ceil(entrants);
    case 'DOUBLE_ELIM':
      // Chave de perdedores: ~2 rodadas por rodada da principal; final (e a revanche, se houver).
      return 2 * log2ceil(entrants) + (cfg.grandFinalReset ? 1 : 0);
    case 'ROUND_ROBIN': {
      const r = entrants % 2 === 0 ? entrants - 1 : entrants;
      return r * (cfg.doubleRound ? 2 : 1);
    }
    case 'SWISS':
      return cfg.rounds;
    case 'GROUPS': {
      if (cfg.groupMode === 'BATTLE_ROYALE') return cfg.drops;
      const size = Math.ceil(entrants / Math.max(1, cfg.groupCount));
      const r = size % 2 === 0 ? size - 1 : size;
      return r * (cfg.doubleRound ? 2 : 1);
    }
    case 'BATTLE_ROYALE':
      // A classificatória com várias salas joga as salas ao mesmo tempo; a final é uma sala só.
      return cfg.drops;
  }
}

/** Minutos de uma rodada da fase (duelo: jogos da série; BR: uma queda). */
export function roundMinutes(stage: StageInput): number {
  const cfg = stage.config;
  if (stage.format === 'BATTLE_ROYALE' || (stage.format === 'GROUPS' && cfg.groupMode === 'BATTLE_ROYALE')) return BR_DROP_MINUTES;
  return DUEL_GAME_MINUTES * Math.max(1, cfg.bestOf);
}

/** Duração estimada das fases, com quantos participantes cada uma recebe. */
export function estimateStages(stages: StageInput[], entrants: number): { rounds: number; minutes: number } {
  let current = entrants;
  let rounds = 0;
  let minutes = 0;
  stages.forEach((stage, index) => {
    const isLast = index === stages.length - 1;
    const r = stageRounds(stage, current);
    rounds += r;
    minutes += r * roundMinutes(stage) + Math.max(0, r - 1) * ROUND_GAP_MINUTES + (index > 0 ? STAGE_GAP_MINUTES : 0);
    const q = stage.qualification;
    if (!isLast && q) {
      const pools = stage.format === 'GROUPS' ? stage.config.groupCount : Math.max(1, Math.ceil(current / stage.config.lobbySize));
      current = (q.type === 'TOP_N_PER_GROUP' ? q.n * pools : q.n) + q.repechage;
    }
  });
  return { rounds, minutes };
}

/** "2 h 30 min", "45 min". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

interface Candidate {
  id: string;
  title: string;
  summary: string;
  stages: StageInput[];
  pros: string[];
  cons: string[];
}

function duelCandidates(n: number, ctx: { game: Game; mode: GameMode; userId: string | null }): Candidate[] {
  const list: Candidate[] = [];
  const team = ctx.mode.teamSize > 1;
  const elim: StageFormat = team && formatAvailability('TEAM_VS_TEAM', ctx.game, ctx.mode).available ? 'TEAM_VS_TEAM' : 'SINGLE_ELIM';

  const md1 = defaultStage(elim, ctx, { isLast: true });
  list.push({
    id: 'mata-mata-md1',
    title: 'Mata-mata em jogo único',
    summary: 'Perdeu, está fora. Cada confronto é decidido em um jogo.',
    stages: [{ ...md1, config: { ...md1.config, bestOf: 1 } }],
    pros: ['O formato mais rápido', 'Fácil de entender e de acompanhar'],
    cons: ['Metade dos inscritos joga uma partida só', 'Um jogo ruim elimina'],
  });
  list.push({
    id: 'mata-mata-md3',
    title: 'Mata-mata melhor de 3',
    summary: 'Mata-mata com séries melhor de 3: quem vence 2 jogos avança.',
    stages: [{ ...md1, name: 'Mata-mata MD3', config: { ...md1.config, bestOf: 3 } }],
    pros: ['Resultado mais justo que o jogo único', 'Continua simples'],
    cons: ['Leva até 3 vezes mais tempo por rodada'],
  });

  if (n >= 8) {
    const groupCount = Math.max(2, largestPowerOfTwo(Math.floor(n / 4)));
    const groups = defaultStage('GROUPS', ctx, { isLast: false });
    const playoff = defaultStage(elim, ctx, { isLast: true, seeding: 'RANKED', name: 'Mata-mata' });
    list.push({
      id: 'grupos-mata-mata',
      title: 'Grupos + mata-mata',
      summary: `${groupCount} grupos de pontos corridos; os 2 melhores de cada grupo vão para o mata-mata.`,
      stages: [
        { ...groups, config: { ...groups.config, groupCount, groupMode: 'DUEL', bestOf: 1, doubleRound: false }, qualification: { type: 'TOP_N_PER_GROUP', n: 2, repechage: 0 } },
        { ...playoff, config: { ...playoff.config, bestOf: 1 } },
      ],
      pros: ['Todo mundo joga várias partidas', 'O mata-mata final recebe os melhores'],
      cons: ['Mais longo que o mata-mata direto', 'Exige acompanhar várias tabelas'],
    });
  }

  if (n >= 6) {
    const swiss = defaultStage('SWISS', ctx, { isLast: true });
    const rounds = Math.min(log2ceil(n), maxSwissRounds(n));
    list.push({
      id: 'suico',
      title: 'Suíço',
      summary: `${rounds} rodadas; cada rodada junta quem tem campanha parecida, sem eliminar ninguém.`,
      stages: [{ ...swiss, config: { ...swiss.config, rounds, bestOf: 1 } }],
      pros: ['Ninguém é eliminado: todos jogam todas as rodadas', 'Poucas rodadas mesmo com muitos inscritos'],
      cons: ['A classificação final depende do desempate', 'Menos emoção de "final"'],
    });
  }

  if (n <= 10) {
    const rr = defaultStage('ROUND_ROBIN', ctx, { isLast: true });
    list.push({
      id: 'pontos-corridos',
      title: 'Pontos corridos',
      summary: 'Todos jogam contra todos e a tabela decide o campeão.',
      stages: [{ ...rr, config: { ...rr.config, bestOf: 1, doubleRound: false } }],
      pros: ['O campeão mais justo', 'Todos jogam o mesmo número de partidas'],
      cons: ['Muitas rodadas: só serve para poucos inscritos'],
    });
  }

  if (n >= 4 && formatAvailability('DOUBLE_ELIM', ctx.game, ctx.mode).available) {
    const de = defaultStage('DOUBLE_ELIM', ctx, { isLast: true });
    list.push({
      id: 'eliminacao-dupla',
      title: 'Eliminação dupla',
      summary: 'Quem perde uma vez cai para a chave de perdedores e só sai na segunda derrota.',
      stages: [{ ...de, config: { ...de.config, bestOf: 1 } }],
      pros: ['Uma derrota não elimina', 'Bom equilíbrio entre justiça e tempo'],
      cons: ['Cerca do dobro de rodadas do mata-mata simples', 'Chave mais difícil de acompanhar'],
    });
  }
  return list;
}

function brCandidates(n: number, ctx: { game: Game; mode: GameMode; userId: string | null }): Candidate[] {
  const list: Candidate[] = [];
  const base = defaultStage('BATTLE_ROYALE', ctx, { isLast: true });
  const lobby = base.config.lobbySize;
  if (n <= lobby) {
    list.push({
      id: 'sala-unica-3',
      title: 'Sala única, 3 quedas',
      summary: `Todas as equipes na mesma sala, 3 quedas somando colocação e kills.`,
      stages: [{ ...base, name: 'Quedas', config: { ...base.config, drops: 3 } }],
      pros: ['O mais rápido', 'Uma tabela só, fácil de transmitir'],
      cons: ['Poucas quedas: uma queda ruim pesa muito'],
    });
    list.push({
      id: 'sala-unica-6',
      title: 'Sala única, 6 quedas',
      summary: `Todas as equipes na mesma sala, 6 quedas.`,
      stages: [{ ...base, name: 'Quedas', config: { ...base.config, drops: 6 } }],
      pros: ['Resultado mais consistente', 'Uma tabela só'],
      cons: ['O dobro do tempo da versão com 3 quedas'],
    });
    return list;
  }
  const suggested = suggestedStages({ ...ctx, maxParticipants: n });
  if (suggested.length > 0) {
    const [first, final] = suggested;
    list.push({
      id: 'grupos-final',
      title: 'Grupos + Grande Final',
      summary: 'Grupos jogam em salas ao mesmo tempo; os melhores de cada grupo fazem a Grande Final em uma sala só.',
      stages: suggested,
      pros: ['Todas as equipes jogam várias quedas', 'Final com os melhores, boa para transmitir'],
      cons: ['Exige uma sala no jogo por grupo ao mesmo tempo'],
    });
    if (first && final) {
      list.push({
        id: 'grupos-final-curto',
        title: 'Grupos + final curta',
        summary: 'Mesmo caminho, com 2 quedas nos grupos e 3 na final.',
        stages: [
          { ...first, config: { ...first.config, drops: 2 } },
          { ...final, config: { ...final.config, drops: 3 } },
        ],
        pros: ['Cabe em menos tempo'],
        cons: ['Menos quedas: mais sorte no resultado'],
      });
    }
  }
  return list;
}

/**
 * Sugestões de formato, já validadas. As que cabem no tempo vêm primeiro (na ordem de preferência); depois as que não
 * cabem, da mais curta para a mais longa. Devolve no máximo 4.
 */
export function suggestFormats(input: FormatAssistantInput): FormatSuggestion[] {
  const { game, mode, userId } = input;
  const entrants = Math.floor(input.entrants);
  if (!game || !mode || !Number.isFinite(entrants) || entrants < 2) return [];
  const ctx = { game, mode, userId };
  const candidates = mode.matchType === 'BATTLE_ROYALE' ? brCandidates(entrants, ctx) : duelCandidates(entrants, ctx);
  const valid = candidates
    .filter((c) => validateStages(c.stages, { maxParticipants: entrants, game, mode }).length === 0)
    .map((c): FormatSuggestion => {
      const { rounds, minutes } = estimateStages(c.stages, entrants);
      return { ...c, rounds, estimatedMinutes: minutes, fits: minutes <= input.availableMinutes };
    });
  const fitting = valid.filter((s) => s.fits);
  const tooLong = valid.filter((s) => !s.fits).sort((a, b) => a.estimatedMinutes - b.estimatedMinutes);
  return [...fitting, ...tooLong].slice(0, 4);
}
