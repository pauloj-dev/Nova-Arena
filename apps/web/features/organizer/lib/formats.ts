/**
 * Os 7 formatos de fase (PRD §10.3): nome e explicação em pt-BR, campos de `StageConfig` que cada um usa,
 * compatibilidade com o modo do jogo e valores padrão. Tudo puro: é usado pelo `StageBuilder`,
 * pela validação entre fases e pela API simulada.
 */
import { StageConfig, type Game, type GameMode, type MatchType, type Qualification, type ScoringModel, type Seeding, type StageFormat, type StageInput, type Tiebreaker } from '@nova/schemas';

export type StageConfigField = keyof StageConfig;

export interface FormatInfo {
  format: StageFormat;
  name: string;
  /** Uma frase para quem nunca organizou campeonato. */
  description: string;
  /** Nome sugerido para uma fase nova deste formato. */
  defaultStageName: string;
}

export const STAGE_FORMAT_ORDER: StageFormat[] = ['SINGLE_ELIM', 'DOUBLE_ELIM', 'GROUPS', 'ROUND_ROBIN', 'SWISS', 'BATTLE_ROYALE', 'TEAM_VS_TEAM'];

export const FORMAT_INFO: Record<StageFormat, FormatInfo> = {
  SINGLE_ELIM: {
    format: 'SINGLE_ELIM',
    name: 'Eliminação simples',
    description: 'Mata-mata: perdeu, está fora. Quem sobra sem adversário na primeira rodada avança direto.',
    defaultStageName: 'Mata-mata',
  },
  DOUBLE_ELIM: {
    format: 'DOUBLE_ELIM',
    name: 'Eliminação dupla',
    description: 'Quem perde uma vez cai para a chave de perdedores e só sai na segunda derrota.',
    defaultStageName: 'Eliminação dupla',
  },
  GROUPS: {
    format: 'GROUPS',
    name: 'Fase de grupos',
    description: 'Os inscritos são divididos em grupos; os melhores de cada grupo avançam.',
    defaultStageName: 'Fase de grupos',
  },
  ROUND_ROBIN: {
    format: 'ROUND_ROBIN',
    name: 'Pontos corridos',
    description: 'Todos jogam contra todos e a tabela decide a classificação.',
    defaultStageName: 'Pontos corridos',
  },
  SWISS: {
    format: 'SWISS',
    name: 'Suíço',
    description: 'Poucas rodadas para muitos inscritos: cada rodada junta quem tem campanha parecida, sem repetir confronto.',
    defaultStageName: 'Suíço',
  },
  BATTLE_ROYALE: {
    format: 'BATTLE_ROYALE',
    name: 'Battle Royale',
    description: 'Várias equipes na mesma sala. Os pontos de cada queda (colocação e kills) são somados.',
    defaultStageName: 'Quedas',
  },
  TEAM_VS_TEAM: {
    format: 'TEAM_VS_TEAM',
    name: 'Equipe x Equipe',
    description: 'Mata-mata entre equipes (ex.: Contra Squad 4v4), em série melhor de 1, 3, 5 ou 7.',
    defaultStageName: 'Mata-mata entre equipes',
  },
};

export const ELIMINATION_FORMATS: StageFormat[] = ['SINGLE_ELIM', 'DOUBLE_ELIM', 'TEAM_VS_TEAM'];
export function isElimination(format: StageFormat): boolean {
  return ELIMINATION_FORMATS.includes(format);
}

/** A fase é jogada em quedas Battle Royale (formato BR ou grupos em modo BR)? */
export function isBattleRoyaleStage(format: StageFormat, config: Pick<StageConfig, 'groupMode'>): boolean {
  return format === 'BATTLE_ROYALE' || (format === 'GROUPS' && config.groupMode === 'BATTLE_ROYALE');
}

/** Campos de `StageConfig` que fazem sentido para o formato (e, nos grupos, para o modo do grupo). */
export function configFieldsFor(format: StageFormat, config: Pick<StageConfig, 'groupMode'>): StageConfigField[] {
  switch (format) {
    case 'SINGLE_ELIM':
    case 'TEAM_VS_TEAM':
      return ['bestOf', 'thirdPlace'];
    case 'DOUBLE_ELIM':
      return ['bestOf', 'grandFinalReset'];
    case 'GROUPS':
      return config.groupMode === 'BATTLE_ROYALE'
        ? ['groupCount', 'groupMode', 'drops', 'lobbySize', 'killsPerPlayer', 'lastDropMultiplier']
        : ['groupCount', 'groupMode', 'bestOf', 'doubleRound'];
    case 'ROUND_ROBIN':
      return ['bestOf', 'doubleRound'];
    case 'SWISS':
      return ['rounds', 'bestOf'];
    case 'BATTLE_ROYALE':
      return ['drops', 'lobbySize', 'killsPerPlayer', 'lastDropMultiplier'];
  }
}

/** Tipo de duelo do modo: equipes (2+ por lado) ou 1v1. */
export function duelMatchType(mode: Pick<GameMode, 'teamSize'>): MatchType {
  return mode.teamSize > 1 ? 'TEAM_VS_TEAM' : 'DUEL';
}

/** Tipo de partida que a fase usa — é ele que decide quais modelos de pontuação servem. */
export function stageMatchType(format: StageFormat, config: Pick<StageConfig, 'groupMode'>, mode: Pick<GameMode, 'teamSize'>): MatchType {
  if (isBattleRoyaleStage(format, config)) return 'BATTLE_ROYALE';
  if (format === 'TEAM_VS_TEAM') return 'TEAM_VS_TEAM';
  return duelMatchType(mode);
}

/**
 * Um modo Battle Royale também pode ter fases de duelo quando o jogo tem um modo de duelo
 * com o mesmo tamanho de equipe (Free Fire Squad → Contra Squad 4v4, exemplo do PRD §10.4).
 */
function gameHasDuelFor(game: Pick<Game, 'modes'>, mode: Pick<GameMode, 'teamSize'>): boolean {
  return game.modes.some((m) => m.matchType !== 'BATTLE_ROYALE' && m.teamSize === mode.teamSize);
}

export interface FormatAvailability {
  available: boolean;
  /** Por que o formato está desabilitado (pt-BR). Nulo quando está disponível. */
  reason: string | null;
}
const OK: FormatAvailability = { available: true, reason: null };
const no = (reason: string): FormatAvailability => ({ available: false, reason });

/** O formato pode ser usado com este modo de jogo? Devolve o motivo quando não pode. */
export function formatAvailability(format: StageFormat, game: Pick<Game, 'name' | 'modes'>, mode: Pick<GameMode, 'name' | 'teamSize' | 'matchType'>): FormatAvailability {
  const isBr = mode.matchType === 'BATTLE_ROYALE';
  if (format === 'BATTLE_ROYALE') {
    return isBr ? OK : no(`Battle Royale só serve para modos em que várias equipes jogam na mesma sala. ${mode.name} é um modo de duelo.`);
  }
  if (format === 'GROUPS') {
    // Em modo BR os grupos jogam quedas; em modo de duelo, pontos corridos. Sempre há uma opção válida.
    return OK;
  }
  if (format === 'TEAM_VS_TEAM' && mode.teamSize < 2) {
    return no(`Equipe x Equipe é para modos em equipe. ${mode.name} é individual: use Eliminação simples.`);
  }
  if (isBr && !gameHasDuelFor(game, mode)) {
    const size = mode.teamSize > 1 ? `equipes de ${mode.teamSize}` : 'jogadores individuais';
    return no(`${game.name} não tem modo de duelo para ${size}. No modo ${mode.name}, use Battle Royale ou Fase de grupos.`);
  }
  return OK;
}

/** Nos grupos: os dois modos de jogo dentro do grupo, com o motivo quando um deles não serve. */
export function groupModeAvailability(groupMode: StageConfig['groupMode'], game: Pick<Game, 'name' | 'modes'>, mode: Pick<GameMode, 'name' | 'teamSize' | 'matchType'>): FormatAvailability {
  const isBr = mode.matchType === 'BATTLE_ROYALE';
  if (groupMode === 'BATTLE_ROYALE') return isBr ? OK : no(`Quedas Battle Royale só existem em modos BR. ${mode.name} é um modo de duelo.`);
  if (isBr && !gameHasDuelFor(game, mode)) return no(`${game.name} não tem modo de duelo para o modo ${mode.name}.`);
  return OK;
}

/** Modelos de pontuação que servem para a fase: do catálogo do jogo ou personalizados por quem está editando. */
export function compatibleScoringModels(game: Pick<Game, 'scoringModels'>, matchType: MatchType, userId: string | null): ScoringModel[] {
  return game.scoringModels
    .filter((m) => m.matchType === matchType && (m.ownerId === null || m.ownerId === userId))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || Number(a.ownerId !== null) - Number(b.ownerId !== null));
}

/** Ordem de desempate sugerida por tipo de partida (PRD §10.6). */
export const DEFAULT_TIEBREAKERS: Record<MatchType, Tiebreaker[]> = {
  BATTLE_ROYALE: ['points', 'booyahs', 'kills', 'avgPlacement', 'lastDropKills', 'draw'],
  DUEL: ['points', 'scoreDiff', 'score', 'headToHead', 'draw'],
  TEAM_VS_TEAM: ['points', 'scoreDiff', 'score', 'headToHead', 'draw'],
};

/** Critérios que fazem sentido para o tipo de partida (os demais não são oferecidos na fase). */
export const TIEBREAKERS_BY_MATCH_TYPE: Record<MatchType, Tiebreaker[]> = {
  BATTLE_ROYALE: ['points', 'booyahs', 'kills', 'avgPlacement', 'lastDropKills', 'draw'],
  DUEL: ['points', 'wins', 'scoreDiff', 'score', 'headToHead', 'draw'],
  TEAM_VS_TEAM: ['points', 'wins', 'scoreDiff', 'score', 'headToHead', 'draw'],
};

/** `wins`/`booyahs` e `score`/`kills` são sinônimos no motor: não faz sentido ter os dois na mesma fase. */
export const TIEBREAKER_SYNONYM: Partial<Record<Tiebreaker, Tiebreaker>> = { wins: 'booyahs', booyahs: 'wins', score: 'kills', kills: 'score' };

/** Padrões de `StageConfig` por formato (ADR-0001: sala de 12, repescagem desligada, kills por equipe). */
export function defaultStageConfig(format: StageFormat, mode?: Pick<GameMode, 'matchType' | 'maxLobbySize'> | null): StageConfig {
  const base = StageConfig.parse({});
  const lobbySize = Math.min(base.lobbySize, mode?.maxLobbySize ?? base.lobbySize);
  switch (format) {
    case 'SINGLE_ELIM':
    case 'TEAM_VS_TEAM':
      return { ...base, bestOf: format === 'TEAM_VS_TEAM' ? 3 : 1, thirdPlace: false };
    case 'DOUBLE_ELIM':
      return { ...base, bestOf: 1, grandFinalReset: true };
    case 'GROUPS':
      return { ...base, groupCount: 4, groupMode: mode?.matchType === 'BATTLE_ROYALE' ? 'BATTLE_ROYALE' : 'DUEL', drops: 3, lobbySize, doubleRound: false };
    case 'ROUND_ROBIN':
      return { ...base, bestOf: 1, doubleRound: false };
    case 'SWISS':
      return { ...base, rounds: 5, bestOf: 1 };
    case 'BATTLE_ROYALE':
      return { ...base, drops: 3, lobbySize, killsPerPlayer: false, lastDropMultiplier: 1 };
  }
}

/** Regra de classificação sugerida quando a fase deixa de ser a última. */
export function defaultQualification(format: StageFormat): Qualification {
  if (format === 'GROUPS') return { type: 'TOP_N_PER_GROUP', n: 2, repechage: 0 };
  if (isElimination(format)) return { type: 'WINNERS', n: 2, repechage: 0 };
  return { type: 'TOP_N_OVERALL', n: 8, repechage: 0 };
}

/** Regras de classificação oferecidas para cada formato. */
export function qualificationTypesFor(format: StageFormat): Qualification['type'][] {
  if (format === 'GROUPS') return ['TOP_N_PER_GROUP', 'TOP_N_OVERALL'];
  if (format === 'BATTLE_ROYALE') return ['TOP_N_OVERALL', 'TOP_N_PER_GROUP'];
  if (isElimination(format)) return ['WINNERS'];
  return ['TOP_N_OVERALL'];
}

export interface StageDefaultsContext {
  game?: Pick<Game, 'name' | 'modes' | 'scoringModels'> | null;
  mode?: Pick<GameMode, 'name' | 'teamSize' | 'matchType' | 'maxLobbySize'> | null;
  /** Quem está editando (para enxergar os próprios modelos personalizados). */
  userId?: string | null;
}

/** Modelo de pontuação padrão para a fase (o marcado como padrão no catálogo, se houver). */
export function defaultScoringModel(format: StageFormat, config: Pick<StageConfig, 'groupMode'>, ctx: StageDefaultsContext): ScoringModel | null {
  if (!ctx.game || !ctx.mode) return null;
  return compatibleScoringModels(ctx.game, stageMatchType(format, config, ctx.mode), ctx.userId ?? null)[0] ?? null;
}

/** Fase nova, com tudo preenchido. `isLast` decide se ela já nasce com regra de classificação. */
export function defaultStage(format: StageFormat, ctx: StageDefaultsContext, opts: { isLast?: boolean; seeding?: Seeding; name?: string } = {}): StageInput {
  const config = defaultStageConfig(format, ctx.mode);
  const model = defaultScoringModel(format, config, ctx);
  const matchType = ctx.mode ? stageMatchType(format, config, ctx.mode) : isBattleRoyaleStage(format, config) ? 'BATTLE_ROYALE' : 'DUEL';
  return {
    name: opts.name ?? FORMAT_INFO[format].defaultStageName,
    format,
    scoringModelId: model?.id ?? '',
    config,
    qualification: opts.isLast === false ? defaultQualification(format) : null,
    tiebreakers: model?.tiebreakers ?? DEFAULT_TIEBREAKERS[matchType],
    seeding: opts.seeding ?? 'RANDOM',
  };
}

/** Primeiro formato disponível para o modo — é o que uma fase nova usa. */
export function suggestedFormat(game: Pick<Game, 'name' | 'modes'>, mode: Pick<GameMode, 'name' | 'teamSize' | 'matchType'>): StageFormat {
  const preferred: StageFormat[] = mode.matchType === 'BATTLE_ROYALE' ? ['BATTLE_ROYALE', 'GROUPS'] : ['SINGLE_ELIM', 'GROUPS'];
  return preferred.find((f) => formatAvailability(f, game, mode).available) ?? 'GROUPS';
}

/** Vagas sugeridas para o modo: 4 salas cheias no Battle Royale, 16 nos duelos. */
export function defaultMaxParticipants(mode: Pick<GameMode, 'matchType' | 'maxLobbySize'> | null | undefined): number {
  if (mode?.matchType !== 'BATTLE_ROYALE') return 16;
  const lobby = defaultStageConfig('BATTLE_ROYALE', mode).lobbySize;
  return lobby >= 48 ? lobby : lobby * 4;
}

/**
 * Fases sugeridas para um campeonato novo, já válidas para as vagas informadas:
 * duelos → um mata-mata; Battle Royale → quedas em sala única ou, se as vagas não cabem
 * em uma sala, grupos BR + grande final.
 */
export function suggestedStages(ctx: StageDefaultsContext & { maxParticipants: number }): StageInput[] {
  const { game, mode } = ctx;
  if (!game || !mode) return [];
  const format = suggestedFormat(game, mode);
  if (format !== 'BATTLE_ROYALE') return [defaultStage(format, ctx, { isLast: true })];

  const lobby = defaultStageConfig('BATTLE_ROYALE', mode).lobbySize;
  const final = defaultStage('BATTLE_ROYALE', ctx, { isLast: true, name: 'Grande Final', seeding: 'RANKED' });
  if (ctx.maxParticipants <= lobby) return [{ ...final, name: 'Quedas', seeding: 'RANDOM' }];

  const groupCount = Math.ceil(ctx.maxParticipants / lobby);
  const perGroup = Math.floor(lobby / groupCount);
  const groupsFit = groupCount <= 64;
  const first = defaultStage(groupsFit ? 'GROUPS' : 'BATTLE_ROYALE', ctx, { isLast: false, name: groupsFit ? 'Fase de grupos' : 'Classificatória' });
  return [
    {
      ...first,
      config: { ...first.config, groupCount: groupsFit ? groupCount : first.config.groupCount, groupMode: 'BATTLE_ROYALE', lobbySize: lobby },
      qualification: groupsFit && perGroup >= 1 ? { type: 'TOP_N_PER_GROUP', n: perGroup, repechage: 0 } : { type: 'TOP_N_OVERALL', n: lobby, repechage: 0 },
    },
    { ...final, config: { ...final.config, drops: 5 } },
  ];
}

/**
 * Troca o formato de uma fase: configuração, pontuação e desempate passam a ser os do formato novo.
 * Ficam o nome que a pessoa escreveu, o chaveamento e, se ainda servir, a regra de classificação.
 * O que a tela guarda a mais na fase (a chave local, o `id`) é preservado.
 */
export function changeStageFormat<T extends StageInput>(stage: T, format: StageFormat, ctx: StageDefaultsContext): T {
  const fresh = defaultStage(format, ctx, { isLast: stage.qualification === null, seeding: stage.seeding });
  const nameWasDefault = stage.name.trim() === '' || stage.name === FORMAT_INFO[stage.format].defaultStageName;
  const keepsQualification = stage.qualification !== null && qualificationTypesFor(format).includes(stage.qualification.type);
  return {
    ...stage,
    ...fresh,
    id: stage.id,
    name: nameWasDefault ? fresh.name : stage.name,
    qualification: stage.qualification === null ? null : keepsQualification ? stage.qualification : defaultQualification(format),
  };
}

/**
 * Depois de adicionar, remover ou reordenar: a última fase fica sem regra de classificação
 * e as outras ganham a regra padrão do formato, se ainda não tinham.
 */
export function normalizeStages<T extends StageInput>(stages: T[]): T[] {
  return stages.map((stage, index) => {
    const isLast = index === stages.length - 1;
    if (isLast) return stage.qualification === null ? stage : { ...stage, qualification: null };
    return stage.qualification !== null ? stage : { ...stage, qualification: defaultQualification(stage.format) };
  });
}
