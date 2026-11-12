/**
 * Pontuação explicada para o jogador, nas páginas públicas (jogo e campeonato).
 * As frases de cada regra vêm de `features/scoring/describe` (a mesma fonte do editor do Admin);
 * aqui fica só o que é da vitrine: o resumo em uma linha e os textos de modo de jogo.
 */
import type { Game, GameMode, MatchType, ScoringModel } from '@nova/schemas';
import { describeModel, scoreLabelForGame } from '@/features/scoring/describe';

type ModelLike = Pick<ScoringModel, 'rules' | 'matchType'>;
type GameLike = Pick<Game, 'slug' | 'extraStatFields'>;

/** Uma frase por regra, com as estatísticas chamadas pelo nome do jogo (coroas, gols, frames). */
export function scoringLines(model: ModelLike, game?: GameLike | null): string[] {
  return describeModel(model.rules, { matchType: model.matchType, extraStats: game?.extraStatFields, scoreLabel: scoreLabelForGame(game?.slug) });
}

/** O modelo em uma linha: "1 ponto por kill · Booyah (1º lugar) vale 3 pontos". */
export function scoringSummary(model: ModelLike, game?: GameLike | null): string {
  return scoringLines(model, game).join(' · ');
}

/** Modelos padrão do catálogo (os que o jogador encontra na maioria dos campeonatos do jogo). */
export function defaultScoringModels(game: Pick<Game, 'scoringModels'>): ScoringModel[] {
  return game.scoringModels.filter((m) => m.isDefault && m.ownerId === null);
}

export const MATCH_TYPE_TEXT: Record<MatchType, string> = {
  DUEL: 'Duelo 1 contra 1',
  TEAM_VS_TEAM: 'Equipe contra equipe',
  BATTLE_ROYALE: 'Battle Royale',
};

/** "Individual", "Equipes de 4 jogadores + 1 reserva". */
export function teamSizeText(mode: Pick<GameMode, 'teamSize' | 'maxSubs'>): string {
  if (mode.teamSize <= 1) return 'Individual';
  const subs = mode.maxSubs > 0 ? ` + ${mode.maxSubs} ${mode.maxSubs === 1 ? 'reserva' : 'reservas'}` : ', sem reservas';
  return `Equipes de ${mode.teamSize} jogadores${subs}`;
}

/** "Battle Royale · até 12 equipes por sala", "Duelo 1 contra 1". */
export function matchTypeText(mode: Pick<GameMode, 'matchType' | 'maxLobbySize' | 'teamSize'>): string {
  const base = MATCH_TYPE_TEXT[mode.matchType];
  if (mode.matchType !== 'BATTLE_ROYALE' || mode.maxLobbySize === null) return base;
  return `${base} · até ${mode.maxLobbySize} ${mode.teamSize <= 1 ? 'jogadores' : 'equipes'} por sala`;
}
