import { z } from 'zod';
import { Id, Slug } from './common';

export const MatchType = z.enum(['DUEL', 'TEAM_VS_TEAM', 'BATTLE_ROYALE']);
export type MatchType = z.infer<typeof MatchType>;

/** Campo que o jogador precisa preencher para aquele jogo (ex.: "ID Free Fire"). */
export const AccountField = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/),
  label: z.string().min(1),
  placeholder: z.string().optional(),
  pattern: z.string().optional(),
});
export type AccountField = z.infer<typeof AccountField>;

/** Estatística extra lançada no resultado (ex.: pênaltis no eFootball). */
export const ExtraStatField = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/),
  label: z.string().min(1),
  /** `tiebreak`: só aparece quando o placar empata em partida eliminatória (RN-14). */
  when: z.enum(['always', 'tiebreak']).default('always'),
});
export type ExtraStatField = z.infer<typeof ExtraStatField>;

export const GameMode = z.object({
  id: Id,
  gameId: Id,
  name: z.string().min(1, 'Dê um nome ao modo'),
  teamSize: z.number().int().min(1).max(10),
  maxSubs: z.number().int().min(0).max(5),
  matchType: MatchType,
  /** Só para Battle Royale: máximo de equipes na mesma sala. */
  maxLobbySize: z.number().int().min(2).max(100).nullable(),
});
export type GameMode = z.infer<typeof GameMode>;

// ── Pontuação (PRD §11) ──────────────────────────────────────────────
export const ScoringRule = z.discriminatedUnion('type', [
  z.object({ type: z.literal('PER_UNIT'), stat: z.string().min(1), points: z.number() }),
  z.object({ type: z.literal('TABLE'), stat: z.string().min(1), table: z.record(z.string(), z.number()) }),
  z.object({ type: z.literal('OUTCOME'), win: z.number(), draw: z.number(), loss: z.number() }),
  z.object({ type: z.literal('BONUS'), stat: z.string().min(1), op: z.enum(['gte', 'lte', 'eq']), value: z.number(), points: z.number() }),
  z.object({ type: z.literal('CAP'), stat: z.string().min(1), max: z.number().min(0) }),
  z.object({
    type: z.literal('MULTIPLIER'),
    factor: z.number().positive(),
    when: z.object({ matchIndex: z.union([z.number().int().min(0), z.literal('last')]).optional() }).optional(),
  }),
]);
export type ScoringRule = z.infer<typeof ScoringRule>;

export const Tiebreaker = z.enum(['points', 'wins', 'score', 'avgPlacement', 'headToHead', 'scoreDiff', 'lastDropKills', 'draw']);
export type Tiebreaker = z.infer<typeof Tiebreaker>;

export const ScoringModel = z.object({
  id: Id,
  gameId: Id,
  name: z.string().min(1, 'Dê um nome ao modelo'),
  matchType: MatchType,
  rules: z.array(ScoringRule).min(1, 'Adicione pelo menos uma regra'),
  tiebreakers: z.array(Tiebreaker).min(1),
  isDefault: z.boolean(),
  /** Nulo = modelo do catálogo; preenchido = modelo personalizado de um organizador. */
  ownerId: Id.nullable(),
});
export type ScoringModel = z.infer<typeof ScoringModel>;
export const ScoringModelInput = ScoringModel.omit({ id: true, gameId: true, ownerId: true });
export type ScoringModelInput = z.infer<typeof ScoringModelInput>;

export const Game = z.object({
  id: Id,
  slug: Slug,
  name: z.string().min(1, 'Dê um nome ao jogo'),
  /** Emoji ou sigla usada como marca do jogo. Não usamos logos oficiais (PRD §22, R5). */
  icon: z.string().max(4),
  coverUrl: z.string().nullable(),
  platform: z.string(),
  active: z.boolean(),
  requiredAccountFields: z.array(AccountField),
  extraStatFields: z.array(ExtraStatField),
  modes: z.array(GameMode),
  scoringModels: z.array(ScoringModel),
});
export type Game = z.infer<typeof Game>;

export const GameInput = z.object({
  name: z.string().min(1, 'Dê um nome ao jogo'),
  slug: Slug,
  icon: z.string().max(4),
  coverUrl: z.string().nullable(),
  platform: z.string().min(1, 'Informe a plataforma'),
  active: z.boolean(),
  requiredAccountFields: z.array(AccountField),
  extraStatFields: z.array(ExtraStatField),
  modes: z.array(GameMode.omit({ gameId: true }).extend({ id: Id.optional() })).min(1, 'Cadastre pelo menos um modo'),
});
export type GameInput = z.infer<typeof GameInput>;
