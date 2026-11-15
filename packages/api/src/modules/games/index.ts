/**
 * Catálogo de jogos (issue #74, ADM-06). Porta de `apps/web/mocks/handlers/games.ts` e `games-admin.ts`.
 *
 * - Leitura pública: lista de jogos **ativos** com os modelos padrão, em cache (Redis) por 10 min e
 *   invalidada em toda edição. Modelos personalizados só aparecem para quem os criou e para o Admin.
 * - Jogo desativado sai da lista (e da criação de campeonatos, #75), mas `GET /games/:slug` continua
 *   respondendo: os campeonatos antigos seguem mostrando o jogo.
 * - Escrita só para Admin e Super Admin, sempre auditada na mesma transação.
 * - Modelo de pontuação passa pelo schema e pelo motor; erro volta por campo (`rules.0`, `name`…).
 *
 * Diferença registrada: o ranking por jogo (`/games/:slug/ranking`) chega com os resultados de partidas (B2).
 */
import { audited, withAudit, type Prisma, type PrismaClient } from '@nova/db';
import { normalizeTiebreakers, scoringFieldErrors, validateScoringDraft } from '@nova/engine';
import { Game, GameAdminInput, GameAdminPatch, ScoringModel, ScoringModelInput, ScoringModelPatch } from '@nova/schemas';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, respond, type AppContext, type AppEnv } from '../../context';
import { badRequest, conflict, HttpProblem, notFound } from '../../errors';
import { ADMIN_ROLES, assertRole, isAdmin } from '../../auth/rbac';
import { currentSession } from '../../auth/session';
import { clientIp } from '../../security';

export const GAMES_CACHE_KEY = 'games:active:v1';
const CACHE_TTL_SECONDS = 600;

export const gameInclude = { modes: { orderBy: { createdAt: 'asc' } }, scoringModels: { orderBy: { createdAt: 'asc' } } } satisfies Prisma.GameInclude;
export type GameRow = Prisma.GameGetPayload<{ include: typeof gameInclude }>;
type ModelRow = GameRow['scoringModels'][number];

const toModel = (m: ModelRow): ScoringModel => ({
  id: m.id,
  gameId: m.gameId,
  name: m.name,
  matchType: m.matchType,
  rules: m.rules as ScoringModel['rules'],
  tiebreakers: m.tiebreakers as ScoringModel['tiebreakers'],
  isDefault: m.isDefault,
  ownerId: m.ownerId,
});

export const toGame = (g: GameRow): Game => ({
  id: g.id,
  slug: g.slug,
  name: g.name,
  icon: g.icon,
  coverUrl: g.coverUrl,
  platform: g.platform,
  active: g.active,
  requiredAccountFields: g.requiredAccountFields as Game['requiredAccountFields'],
  extraStatFields: g.extraStatFields as Game['extraStatFields'],
  modes: g.modes.map((m) => ({ id: m.id, gameId: m.gameId, name: m.name, teamSize: m.teamSize, maxSubs: m.maxSubs, matchType: m.matchType, maxLobbySize: m.maxLobbySize })),
  scoringModels: g.scoringModels.map(toModel),
});

/** Quem está vendo: Admin vê todos os modelos; os demais, os do catálogo e os próprios. */
async function viewer(c: AppContext): Promise<{ id: string | null; admin: boolean }> {
  const session = await currentSession(c);
  if (!session) return { id: null, admin: false };
  const roles = (await c.get('deps').db().userRole.findMany({ where: { userId: session.userId }, select: { role: true } })).map((r) => r.role);
  return { id: session.userId, admin: isAdmin(roles) };
}

const visibleModels = (game: Game, who: { id: string | null; admin: boolean }): Game => ({
  ...game,
  scoringModels: game.scoringModels.filter((m) => m.ownerId === null || who.admin || m.ownerId === who.id),
});

/** Catálogo público em cache: jogos ativos com os modelos do catálogo (sem os personalizados). */
async function activeCatalog(c: AppContext): Promise<Game[]> {
  const cache = c.get('deps').cache(c.get('env'));
  const cached = await cache.get<Game[]>(GAMES_CACHE_KEY).catch(() => null);
  if (cached) return cached;
  const rows = await c.get('deps').db().game.findMany({ where: { active: true }, include: { ...gameInclude, scoringModels: { where: { ownerId: null }, orderBy: { createdAt: 'asc' } } }, orderBy: { name: 'asc' } });
  const games = rows.map(toGame);
  await cache.set(GAMES_CACHE_KEY, games, CACHE_TTL_SECONDS).catch((error: unknown) => c.get('log').warn('cache de jogos indisponível', { error: String(error) }));
  return games;
}

async function invalidateCatalog(c: AppContext): Promise<void> {
  await c
    .get('deps')
    .cache(c.get('env'))
    .del(GAMES_CACHE_KEY)
    .catch((error: unknown) => c.get('log').warn('não foi possível invalidar o cache de jogos', { error: String(error) }));
}

async function findGameRow(db: PrismaClient | Prisma.TransactionClient, idOrSlug: string): Promise<GameRow> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
  const game = await db.game.findFirst({ where: isUuid ? { id: idOrSlug } : { slug: idOrSlug }, include: gameInclude });
  if (!game) throw notFound('Jogo');
  return game;
}

/** Além do schema, o modelo passa pela validação do motor; os erros voltam por regra (`rules.0`). */
function assertModelValid(model: Pick<ScoringModel, 'name' | 'matchType' | 'rules' | 'tiebreakers'>): void {
  const errors = validateScoringDraft(model);
  if (errors.length > 0) throw badRequest('Confira as regras do modelo.', 'VALIDATION', scoringFieldErrors(errors));
}

function quoteNames(names: string[]): string {
  const [first, ...rest] = names;
  if (rest.length === 0) return `pelo campeonato "${first}"`;
  return `pelo campeonato "${first}" e por mais ${rest.length}`;
}

async function tournamentsUsingModel(db: Prisma.TransactionClient, modelId: string): Promise<string[]> {
  const rows = await db.tournament.findMany({ where: { stages: { some: { scoringModelId: modelId } } }, select: { name: true }, take: 5 });
  return rows.map((r) => r.name);
}

function slugTaken(): HttpProblem {
  const message = 'Já existe um jogo com este endereço. Escolha outro.';
  return new HttpProblem(409, message, 'SLUG_TAKEN', { slug: message });
}

const isUniqueViolation = (error: unknown) => error instanceof Error && 'code' in error && (error as { code?: string }).code === 'P2002';

/** Admin + contexto de auditoria (autor, IP e navegador). */
async function adminContext(c: AppContext) {
  await assertRole(c, ADMIN_ROLES);
  const session = await currentSession(c);
  return { actorId: session?.userId ?? null, ip: clientIp(c.req.raw.headers), userAgent: c.req.header('user-agent') ?? null };
}

const modeData = (m: GameAdminInput['modes'][number]) => ({
  name: m.name.trim(),
  teamSize: m.teamSize,
  maxSubs: m.maxSubs,
  matchType: m.matchType,
  maxLobbySize: m.matchType === 'BATTLE_ROYALE' ? m.maxLobbySize : null,
});

export const games = new Hono<AppEnv>();

// ── Leitura pública ─────────────────────────────────────────────────
games.get('/games', async (c) => {
  const who = await viewer(c);
  // Jogos desativados só aparecem para o Admin (e com `all=1`).
  if (c.req.query('all') === '1' && who.admin) {
    const rows = await c.get('deps').db().game.findMany({ include: gameInclude, orderBy: { name: 'asc' } });
    return respond(c, z.array(Game), rows.map(toGame));
  }
  const catalog = await activeCatalog(c);
  if (!who.id) return respond(c, z.array(Game), catalog);
  // Logado: junta os modelos personalizados da pessoa (o Admin vê os de todos).
  const custom = await c
    .get('deps')
    .db()
    .scoringModel.findMany({ where: { ownerId: who.admin ? { not: null } : who.id, gameId: { in: catalog.map((g) => g.id) } }, orderBy: { createdAt: 'asc' } });
  return respond(
    c,
    z.array(Game),
    catalog.map((g) => ({ ...g, scoringModels: [...g.scoringModels, ...custom.filter((m) => m.gameId === g.id).map(toModel)] })),
  );
});

games.get('/games/:slug', async (c) => {
  const game = await findGameRow(c.get('deps').db(), c.req.param('slug'));
  return respond(c, Game, visibleModels(toGame(game), await viewer(c)));
});

// ── Cadastro pelo Admin ─────────────────────────────────────────────
games.post('/admin/games', async (c) => {
  const ctx = await adminContext(c);
  const input = await body(c, GameAdminInput);
  const db = c.get('deps').db();
  try {
    const created = await withAudit(db, ctx, async (tx) => {
      const game = await tx.game.create({
        data: {
          slug: input.slug,
          name: input.name.trim(),
          icon: input.icon,
          coverUrl: input.coverUrl,
          platform: input.platform.trim(),
          active: input.active,
          requiredAccountFields: input.requiredAccountFields,
          extraStatFields: input.extraStatFields,
          modes: { create: input.modes.map(modeData) },
        },
        include: gameInclude,
      });
      await audited(tx, { action: 'GAME_CREATED', entityType: 'Game', entityId: game.id, entityLabel: game.name, after: toGame(game) });
      return game;
    });
    await invalidateCatalog(c);
    return respond(c, Game, toGame(created), 201);
  } catch (error) {
    if (isUniqueViolation(error)) throw slugTaken();
    throw error;
  }
});

games.patch('/admin/games/:id', async (c) => {
  const ctx = await adminContext(c);
  const patch = await body(c, GameAdminPatch);
  const db = c.get('deps').db();
  try {
    const updated = await withAudit(db, ctx, async (tx) => {
      const game = await findGameRow(tx, c.req.param('id'));
      const before = toGame(game);
      const { modes, ...fields } = patch;
      if (modes !== undefined) {
        // Modo com campeonato criado não pode sumir: o campeonato ficaria sem tamanho de equipe.
        for (const mode of game.modes) {
          if (modes.some((m) => m.id === mode.id)) continue;
          const used = await tx.tournament.findMany({ where: { gameModeId: mode.id }, select: { name: true }, take: 5 });
          if (used.length > 0) throw conflict(`O modo "${mode.name}" é usado ${quoteNames(used.map((t) => t.name))} e não pode ser removido.`, 'MODE_IN_USE');
          await tx.gameMode.delete({ where: { id: mode.id } });
        }
        for (const mode of modes) {
          const known = mode.id ? game.modes.find((m) => m.id === mode.id) : undefined;
          if (known) await tx.gameMode.update({ where: { id: known.id }, data: modeData(mode) });
          else await tx.gameMode.create({ data: { ...modeData(mode), gameId: game.id } });
        }
      }
      const data: Prisma.GameUpdateInput = {};
      if (fields.slug !== undefined) data.slug = fields.slug;
      if (fields.name !== undefined) data.name = fields.name.trim();
      if (fields.icon !== undefined) data.icon = fields.icon;
      if (fields.coverUrl !== undefined) data.coverUrl = fields.coverUrl;
      if (fields.platform !== undefined) data.platform = fields.platform.trim();
      if (fields.active !== undefined) data.active = fields.active;
      if (fields.requiredAccountFields !== undefined) data.requiredAccountFields = fields.requiredAccountFields;
      if (fields.extraStatFields !== undefined) data.extraStatFields = fields.extraStatFields;
      const after = await tx.game.update({ where: { id: game.id }, data, include: gameInclude });
      await audited(tx, { action: 'GAME_UPDATED', entityType: 'Game', entityId: game.id, entityLabel: after.name, before, after: toGame(after) });
      return after;
    });
    await invalidateCatalog(c);
    return respond(c, Game, toGame(updated));
  } catch (error) {
    if (isUniqueViolation(error)) throw slugTaken();
    throw error;
  }
});

// ── Modelos de pontuação do catálogo ────────────────────────────────
/** Só um modelo padrão por tipo de partida em cada jogo. */
async function keepSingleDefault(tx: Prisma.TransactionClient, model: ModelRow): Promise<void> {
  if (!model.isDefault) return;
  await tx.scoringModel.updateMany({ where: { gameId: model.gameId, ownerId: null, matchType: model.matchType, id: { not: model.id } }, data: { isDefault: false } });
}

function copyName(existing: string[], name: string): string {
  const base = `${name} (cópia)`;
  if (!existing.includes(base)) return base;
  for (let i = 2; i < 100; i += 1) {
    const candidate = `${name} (cópia ${i})`;
    if (!existing.includes(candidate)) return candidate;
  }
  return base;
}

function findModelIn(game: GameRow, modelId: string): ModelRow {
  const model = game.scoringModels.find((m) => m.id === modelId);
  if (!model) throw notFound('Modelo de pontuação');
  return model;
}

games.post('/admin/games/:id/scoring-models/:modelId/duplicate', async (c) => {
  const ctx = await adminContext(c);
  const db = c.get('deps').db();
  const copy = await withAudit(db, ctx, async (tx) => {
    const game = await findGameRow(tx, c.req.param('id'));
    const source = findModelIn(game, c.req.param('modelId'));
    const created = await tx.scoringModel.create({
      data: { gameId: game.id, name: copyName(game.scoringModels.map((m) => m.name), source.name), matchType: source.matchType, rules: source.rules as Prisma.InputJsonValue, tiebreakers: source.tiebreakers as Prisma.InputJsonValue, isDefault: false, ownerId: null },
    });
    await audited(tx, { action: 'SCORING_MODEL_CHANGED', entityType: 'ScoringModel', entityId: created.id, entityLabel: created.name, after: toModel(created) });
    return created;
  });
  await invalidateCatalog(c);
  return respond(c, ScoringModel, toModel(copy), 201);
});

games.patch('/admin/games/:id/scoring-models/:modelId', async (c) => {
  const ctx = await adminContext(c);
  const patch = await body(c, ScoringModelPatch);
  const db = c.get('deps').db();
  const updated = await withAudit(db, ctx, async (tx) => {
    const game = await findGameRow(tx, c.req.param('id'));
    const model = findModelIn(game, c.req.param('modelId'));
    const before = toModel(model);
    const next = { ...before, ...patch, tiebreakers: normalizeTiebreakers(patch.tiebreakers ?? before.tiebreakers) };
    assertModelValid(next);
    if (next.matchType !== model.matchType) {
      const used = await tournamentsUsingModel(tx, model.id);
      if (used.length > 0) throw conflict(`Este modelo é usado ${quoteNames(used)}. Para mudar o tipo de partida, duplique o modelo e edite a cópia.`, 'SCORING_MODEL_IN_USE');
    }
    const saved = await tx.scoringModel.update({
      where: { id: model.id },
      data: { name: next.name, matchType: next.matchType, rules: next.rules as Prisma.InputJsonValue, tiebreakers: next.tiebreakers, isDefault: next.isDefault },
    });
    await keepSingleDefault(tx, saved);
    await audited(tx, { action: 'SCORING_MODEL_CHANGED', entityType: 'ScoringModel', entityId: saved.id, entityLabel: saved.name, before, after: toModel(saved) });
    return saved;
  });
  await invalidateCatalog(c);
  return respond(c, ScoringModel, toModel(updated));
});

games.delete('/admin/games/:id/scoring-models/:modelId', async (c) => {
  const ctx = await adminContext(c);
  const db = c.get('deps').db();
  await withAudit(db, ctx, async (tx) => {
    const game = await findGameRow(tx, c.req.param('id'));
    const model = findModelIn(game, c.req.param('modelId'));
    const used = await tournamentsUsingModel(tx, model.id);
    if (used.length > 0) throw conflict(`Este modelo é usado ${quoteNames(used)} e não pode ser excluído. Troque o modelo das fases antes.`, 'SCORING_MODEL_IN_USE');
    await tx.scoringModel.delete({ where: { id: model.id } });
    await audited(tx, { action: 'SCORING_MODEL_CHANGED', entityType: 'ScoringModel', entityId: model.id, entityLabel: model.name, before: toModel(model) });
  });
  await invalidateCatalog(c);
  return c.body(null, 204);
});

games.post('/admin/games/:id/scoring-models', async (c) => {
  const ctx = await adminContext(c);
  const input = await body(c, ScoringModelInput);
  assertModelValid(input);
  const db = c.get('deps').db();
  const created = await withAudit(db, ctx, async (tx) => {
    const game = await findGameRow(tx, c.req.param('id'));
    // "Pontos" é sempre o primeiro critério e "sorteio", quando ligado, o último.
    const model = await tx.scoringModel.create({
      data: { gameId: game.id, name: input.name, matchType: input.matchType, rules: input.rules as Prisma.InputJsonValue, tiebreakers: normalizeTiebreakers(input.tiebreakers), isDefault: input.isDefault, ownerId: null },
    });
    await keepSingleDefault(tx, model);
    await audited(tx, { action: 'SCORING_MODEL_CHANGED', entityType: 'ScoringModel', entityId: model.id, entityLabel: model.name, after: toModel(model) });
    return model;
  });
  await invalidateCatalog(c);
  return respond(c, ScoringModel, toModel(created), 201);
});
