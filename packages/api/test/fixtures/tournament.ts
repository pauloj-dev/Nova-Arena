/** Rascunho publicável usado nos testes de campeonato (conferido sem banco em `tournaments.unit.test.ts`). */
import { StageConfig, type Game, type TournamentDraftInput } from '@nova/schemas';

export const DUEL_RULES = [{ type: 'OUTCOME' as const, win: 3, draw: 1, loss: 0 }];

/** Jogo de duelo com um modo 1x1 e um modelo de vitória (ids preenchidos por quem usa). */
export function duelGame(ids: { gameId: string; modeId: string; modelId: string }): Game {
  return {
    id: ids.gameId,
    slug: 'duelo',
    name: 'Duelo',
    icon: '⚔️',
    coverUrl: null,
    platform: 'mobile',
    active: true,
    requiredAccountFields: [],
    extraStatFields: [],
    modes: [{ id: ids.modeId, gameId: ids.gameId, name: '1x1', teamSize: 1, maxSubs: 0, matchType: 'DUEL', maxLobbySize: null }],
    scoringModels: [{ id: ids.modelId, gameId: ids.gameId, name: 'Vitória', matchType: 'DUEL', rules: DUEL_RULES, tiebreakers: ['points', 'wins'], isDefault: true, ownerId: null }],
  };
}

/** Datas no futuro em relação a `now`. */
export function publishableDraft(ids: { gameId: string; modeId: string; modelId: string }, now = new Date()): TournamentDraftInput {
  const day = 24 * 3600_000;
  return {
    name: 'Copa de Teste',
    description: '<p>Campeonato de teste.</p>',
    rules: '<p>Regulamento de teste.</p>',
    prize: '',
    gameId: ids.gameId,
    gameModeId: ids.modeId,
    maxParticipants: 8,
    registrationOpensAt: null,
    registrationClosesAt: new Date(now.getTime() + 5 * day).toISOString(),
    startsAt: new Date(now.getTime() + 6 * day).toISOString(),
    stages: [{ name: 'Mata-mata', format: 'SINGLE_ELIM', scoringModelId: ids.modelId, config: StageConfig.parse({}), qualification: null, tiebreakers: ['points', 'wins'], seeding: 'RANDOM' }],
  };
}
