/**
 * Módulo `games-admin` da API simulada: cadastro de jogos e de modelos de pontuação (ADM-06).
 * Só Admin e Super Admin escrevem no catálogo; para os demais ele é somente leitura (PRD §6).
 */
import { http, type HttpHandler } from 'msw';
import { GameAdminInput, GameAdminPatch, ScoringModelInput, ScoringModelPatch, type Game, type GameMode, type ScoringModel } from '@nova/schemas';
import { normalizeTiebreakers } from '../../features/scoring/tiebreakers';
import { toFieldErrors, validateDraft } from '../../features/scoring/validation';
import { db, save, uid } from '../db';
import { badRequest, body, conflict, handle, HttpProblem, json, noContent, notFound, param, requireAdmin, url, type HandlerArgs } from '../http';

export const moduleName = 'games-admin';

function findGame(params: HandlerArgs['params']): Game {
  const id = param(params, 'id');
  const game = db().games.find((g) => g.id === id || g.slug === id);
  if (!game) throw notFound('Jogo');
  return game;
}

function findModel(game: Game, params: HandlerArgs['params']): ScoringModel {
  const modelId = param(params, 'modelId');
  const model = game.scoringModels.find((m) => m.id === modelId);
  if (!model) throw notFound('Modelo de pontuação');
  return model;
}

function assertSlugFree(slug: string, exceptGameId?: string): void {
  if (db().games.some((g) => g.slug === slug && g.id !== exceptGameId)) {
    const message = 'Já existe um jogo com este endereço. Escolha outro.';
    throw new HttpProblem(409, message, 'SLUG_TAKEN', { slug: message });
  }
}

type ModeInput = GameAdminInput['modes'][number];

/** Mantém o `id` dos modos que já existiam e cria `id` para os novos. Sala máxima só vale no Battle Royale. */
function buildModes(gameId: string, input: ModeInput[], existing: GameMode[] = []): GameMode[] {
  return input.map((mode) => {
    const known = mode.id ? existing.find((m) => m.id === mode.id) : undefined;
    return {
      id: known?.id ?? uid('m'),
      gameId,
      name: mode.name.trim(),
      teamSize: mode.teamSize,
      maxSubs: mode.maxSubs,
      matchType: mode.matchType,
      maxLobbySize: mode.matchType === 'BATTLE_ROYALE' ? mode.maxLobbySize : null,
    };
  });
}

function quoteNames(names: string[]): string {
  const [first, ...rest] = names;
  if (rest.length === 0) return `pelo campeonato "${first}"`;
  return `pelo campeonato "${first}" e por mais ${rest.length}`;
}

/** Modo com campeonato criado não pode sumir: o campeonato ficaria sem tamanho de equipe. */
function assertRemovedModesUnused(game: Game, next: GameMode[]): void {
  for (const mode of game.modes) {
    if (next.some((m) => m.id === mode.id)) continue;
    const used = db().tournaments.filter((t) => t.gameModeId === mode.id);
    if (used.length > 0) {
      throw conflict(`O modo "${mode.name}" é usado ${quoteNames(used.map((t) => t.name))} e não pode ser removido.`, 'MODE_IN_USE');
    }
  }
}

function tournamentsUsingModel(modelId: string): string[] {
  return db()
    .tournaments.filter((t) => t.stages.some((s) => s.scoringModelId === modelId))
    .map((t) => t.name);
}

/** Além do schema, o modelo passa pela validação do motor; os erros voltam por regra (`rules.0`). */
function assertModelValid(model: Pick<ScoringModel, 'name' | 'matchType' | 'rules' | 'tiebreakers'>): void {
  const errors = validateDraft(model);
  if (errors.length > 0) throw badRequest('Confira as regras do modelo.', 'VALIDATION', toFieldErrors(errors));
}

/** Só um modelo padrão por tipo de partida em cada jogo. */
function keepSingleDefault(game: Game, chosen: ScoringModel): void {
  if (!chosen.isDefault) return;
  for (const other of game.scoringModels) {
    if (other.id !== chosen.id && other.ownerId === null && other.matchType === chosen.matchType) other.isDefault = false;
  }
}

function copyName(game: Game, name: string): string {
  const base = `${name} (cópia)`;
  if (!game.scoringModels.some((m) => m.name === base)) return base;
  for (let i = 2; i < 100; i += 1) {
    const candidate = `${name} (cópia ${i})`;
    if (!game.scoringModels.some((m) => m.name === candidate)) return candidate;
  }
  return base;
}

export const handlers: HttpHandler[] = [
  // Rotas de modelo antes das de jogo: são mais específicas.
  http.post(
    url('/admin/games/:id/scoring-models/:modelId/duplicate'),
    handle(({ params }) => {
      requireAdmin();
      const game = findGame(params);
      const source = findModel(game, params);
      const copy: ScoringModel = { ...structuredClone(source), id: uid('sm'), name: copyName(game, source.name), isDefault: false, ownerId: null };
      game.scoringModels.push(copy);
      save();
      return json(copy, 201);
    }),
  ),

  http.patch(
    url('/admin/games/:id/scoring-models/:modelId'),
    handle(async ({ request, params }) => {
      requireAdmin();
      const game = findGame(params);
      const model = findModel(game, params);
      const patch = await body(request, ScoringModelPatch);
      const next: ScoringModel = { ...model, ...patch };
      next.tiebreakers = normalizeTiebreakers(next.tiebreakers);
      assertModelValid(next);
      if (next.matchType !== model.matchType) {
        const used = tournamentsUsingModel(model.id);
        if (used.length > 0) {
          throw conflict(`Este modelo é usado ${quoteNames(used)}. Para mudar o tipo de partida, duplique o modelo e edite a cópia.`, 'SCORING_MODEL_IN_USE');
        }
      }
      Object.assign(model, next);
      keepSingleDefault(game, model);
      save();
      return json(model);
    }),
  ),

  http.delete(
    url('/admin/games/:id/scoring-models/:modelId'),
    handle(({ params }) => {
      requireAdmin();
      const game = findGame(params);
      const model = findModel(game, params);
      const used = tournamentsUsingModel(model.id);
      if (used.length > 0) {
        throw conflict(`Este modelo é usado ${quoteNames(used)} e não pode ser excluído. Troque o modelo das fases antes.`, 'SCORING_MODEL_IN_USE');
      }
      game.scoringModels = game.scoringModels.filter((m) => m.id !== model.id);
      save();
      return noContent();
    }),
  ),

  http.post(
    url('/admin/games/:id/scoring-models'),
    handle(async ({ request, params }) => {
      requireAdmin();
      const game = findGame(params);
      const input = await body(request, ScoringModelInput);
      assertModelValid(input);
      // "Pontos" é sempre o primeiro critério e "sorteio", quando ligado, o último.
      const model: ScoringModel = { ...input, tiebreakers: normalizeTiebreakers(input.tiebreakers), id: uid('sm'), gameId: game.id, ownerId: null };
      game.scoringModels.push(model);
      keepSingleDefault(game, model);
      save();
      return json(model, 201);
    }),
  ),

  http.post(
    url('/admin/games'),
    handle(async ({ request }) => {
      requireAdmin();
      const input = await body(request, GameAdminInput);
      assertSlugFree(input.slug);
      const id = uid('g');
      const game: Game = {
        id,
        slug: input.slug,
        name: input.name.trim(),
        icon: input.icon,
        coverUrl: input.coverUrl,
        platform: input.platform.trim(),
        active: input.active,
        requiredAccountFields: input.requiredAccountFields,
        extraStatFields: input.extraStatFields,
        modes: buildModes(id, input.modes),
        scoringModels: [],
      };
      db().games.push(game);
      save();
      return json(game, 201);
    }),
  ),

  http.patch(
    url('/admin/games/:id'),
    handle(async ({ request, params }) => {
      requireAdmin();
      const game = findGame(params);
      const patch = await body(request, GameAdminPatch);
      if (patch.slug !== undefined) assertSlugFree(patch.slug, game.id);

      const { modes, ...fields } = patch;
      if (modes !== undefined) {
        const next = buildModes(game.id, modes, game.modes);
        assertRemovedModesUnused(game, next);
        game.modes = next;
      }
      Object.assign(game, fields);
      save();
      return json(game);
    }),
  ),
];
