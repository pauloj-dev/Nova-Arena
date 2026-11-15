/**
 * Campeonatos (issue #75, PRD §8.3, ORG-01/02/10, RN-10). Porta de `tournaments-manage.ts` e da parte de
 * equipe e ciclo de vida de `tournaments-ops.ts` da API simulada: mesmas rotas, mensagens e códigos.
 *
 * - Rascunho automático: criar já grava; cada edição salva o que veio (ausente = não muda).
 * - Máquina de estados do §8.3 (`canTransition`): transição inválida = 409 `INVALID_TRANSITION`.
 * - Validação do rascunho e das fases com as regras compartilhadas (`validateDraft`, que usa o motor).
 * - Limites do organizador (RN-10: campeonatos simultâneos e jogos liberados) conferidos ao publicar.
 * - Publicar, cancelar, excluir e montar a equipe: só o responsável (ou o Admin). Co-organizador edita e opera.
 * - Toda mudança de status e de equipe é auditada na mesma transação.
 *
 * Diferenças registradas no PR: listagem pública, comunicados e abertura/fechamento agendados chegam na #76;
 * notificações (#98), prévia de chave (B2) e troca do modelo de uma fase em andamento (#87) ficam para B2.
 */
import { audited, Prisma, withAudit, type PrismaClient } from '@nova/db';
import { scoringFieldErrors, validateScoringDraft } from '@nova/engine';
import {
  CancelTournamentInput,
  canTransition,
  checkOrganizerLimits,
  countActiveTournaments,
  CreateTournamentInput,
  CustomScoringModelInput,
  isGameAllowed,
  OrganizerTournament,
  OrganizerTournamentDetail,
  PauseTournamentInput,
  ResumeTournamentInput,
  sanitizeTournamentHtml,
  SaveTemplateInput,
  ScoringModel,
  StaffInput,
  StaffRoleInput,
  TournamentDraftInput,
  TournamentStaff,
  TournamentTemplate,
  validateDraft,
  type DraftForValidation,
  type DraftIssue,
  type Game,
  type OrganizerForLimits,
  type StageInput,
  type TournamentAccessRole,
  type TournamentStatus,
} from '@nova/schemas';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, respond, type AppContext, type AppEnv } from '../../context';
import { badRequest, conflict, forbidden, HttpProblem, notFound } from '../../errors';
import { assertTournamentAccess, currentRoles, isAdmin, ORGANIZER_AREA_ROLES, assertRole, type TournamentAccessLevel } from '../../auth/rbac';
import { requireSession } from '../../auth/session';
import { clientIp } from '../../security';
import { gameInclude, toGame } from '../games';
import { accessRole, checkInOf, countsOf, toOrganizerDetail, toOrganizerTournament, toStage, tournamentInclude, type TournamentRow } from './views';

export const UNNAMED_TOURNAMENT = 'Campeonato sem nome';
const READ_ONLY: TournamentStatus[] = ['FINISHED', 'ARCHIVED', 'CANCELLED'];
const STARTED: TournamentStatus[] = ['IN_PROGRESS', 'PAUSED'];
const CLOSED_FOR_STAFF: TournamentStatus[] = ['CANCELLED', 'ARCHIVED'];
const ROLE_LABEL = { CO_ORGANIZER: 'co-organizador', MODERATOR: 'moderador' } as const;

type Db = PrismaClient | Prisma.TransactionClient;

// ── Utilidades ───────────────────────────────────────────────────────
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

async function uniqueSlug(db: Db, base: string, exceptId?: string): Promise<string> {
  const root = slugify(base) || 'campeonato';
  const taken = new Set((await db.tournament.findMany({ where: { slug: { startsWith: root }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { slug: true } })).map((t) => t.slug));
  if (!taken.has(root)) return root;
  for (let i = 2; i < 1000; i += 1) if (!taken.has(`${root}-${i}`)) return `${root}-${i}`;
  return `${root}-${Date.now().toString(36)}`;
}

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const date = (v: string | null | undefined) => (v ? new Date(v) : null);
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function loadTournament(db: Db, idOrSlug: string): Promise<TournamentRow> {
  const t = await db.tournament.findUnique({ where: isUuid(idOrSlug) ? { id: idOrSlug } : { slug: idOrSlug }, include: tournamentInclude });
  if (!t) throw notFound('Campeonato');
  return t;
}

/** Papel de quem pede no campeonato (403 para quem não é da organização). */
async function accessTo(c: AppContext, t: { id: string }, level: TournamentAccessLevel = 'manage'): Promise<TournamentAccessRole> {
  return accessRole((await assertTournamentAccess(c, t.id, level)).via);
}

/** Publicar, cancelar, excluir e montar a equipe são do responsável (ou do Admin). */
async function ownerAccess(c: AppContext, t: { id: string }, what: string): Promise<TournamentAccessRole> {
  const access = await accessTo(c, t);
  if (access === 'CO_ORGANIZER') throw forbidden(`Só quem é responsável pelo campeonato pode ${what}.`);
  return access;
}

async function auditCtx(c: AppContext) {
  const session = await requireSession(c);
  return { actorId: session.userId, ip: clientIp(c.req.raw.headers), userAgent: c.req.header('user-agent') ?? null };
}

/** Catálogo para validar o rascunho: jogos com os modelos do catálogo e os personalizados das pessoas indicadas. */
async function gamesFor(db: Db, ownerIds: string[]): Promise<Game[]> {
  const rows = await db.game.findMany({ include: { ...gameInclude, scoringModels: { where: { OR: [{ ownerId: null }, { ownerId: { in: ownerIds } }] }, orderBy: { createdAt: 'asc' } } } });
  return rows.map(toGame);
}

async function limitsOf(db: Db, userId: string): Promise<OrganizerForLimits> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { roles: true, organizerLimits: true } });
  const limits = user.organizerLimits;
  return {
    isAdmin: isAdmin(user.roles.map((r) => r.role)),
    verifiedOrganizer: limits?.verified ?? false,
    // Linha sem jogos e com o limite padrão = sem configuração própria (usa o padrão da RN-10).
    organizerLimits: limits && (limits.allowedGameIds.length > 0 || limits.maxActiveTournaments !== 3) ? { maxActiveTournaments: limits.maxActiveTournaments, allowedGameIds: limits.allowedGameIds } : null,
  };
}

function toDraft(t: TournamentRow): DraftForValidation {
  return {
    name: t.name === UNNAMED_TOURNAMENT ? '' : t.name,
    description: t.description,
    rules: t.rules,
    prize: t.prize,
    streamUrls: t.streamUrls,
    gameId: t.gameId,
    gameModeId: t.gameModeId,
    maxParticipants: t.maxParticipants,
    registrationOpensAt: iso(t.registrationOpensAt),
    registrationClosesAt: iso(t.registrationClosesAt),
    startsAt: iso(t.startsAt),
    rosterLockAt: iso(t.rosterLockAt),
    checkIn: checkInOf(t.checkInConfig),
    stages: t.stages.map((s) => {
      const stage = toStage(s);
      return { id: stage.id, name: stage.name, format: stage.format, scoringModelId: stage.scoringModelId, config: stage.config, qualification: stage.qualification, tiebreakers: stage.tiebreakers, seeding: stage.seeding };
    }),
  };
}

/** Uma mensagem por campo, no formato de erros da API. */
function issuesToErrors(issues: DraftIssue[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) errors[issue.field] ??= issue.message;
  return errors;
}

async function detail(c: AppContext, db: Db, id: string, access: TournamentAccessRole, status: 200 | 201 = 200) {
  const t = await loadTournament(db, id);
  const counts = (await countsOf(db, [t.id])).get(t.id);
  return respond(c, OrganizerTournamentDetail, toOrganizerDetail(t, access, counts), status);
}

// ── Rascunho: aplicar o que veio do assistente ───────────────────────
async function requireGameAndMode(db: Db, gameId: string, gameModeId: string) {
  const game = await db.game.findUnique({ where: { id: gameId }, include: { modes: true } });
  if (!game) throw badRequest('Confira os campos destacados.', 'VALIDATION', { gameId: 'Este jogo não existe no catálogo.' });
  const mode = game.modes.find((m) => m.id === gameModeId);
  if (!mode) throw badRequest('Confira os campos destacados.', 'VALIDATION', { gameModeId: `Este modo não existe em ${game.name}.` });
  return { game, mode };
}

/**
 * Grava a lista de fases vinda da tela. Fase que já começou (`status !== 'PENDING'`) não pode mudar de
 * configuração, de posição nem ser removida (US-ORG-05).
 */
async function writeStages(tx: Prisma.TransactionClient, t: TournamentRow, inputs: StageInput[]): Promise<void> {
  const current = t.stages;
  current.forEach((existing, index) => {
    if (existing.status === 'PENDING') return;
    const incoming = inputs[index];
    const stage = toStage(existing);
    const unchanged =
      incoming !== undefined &&
      incoming.id === stage.id &&
      incoming.format === stage.format &&
      incoming.scoringModelId === stage.scoringModelId &&
      incoming.seeding === stage.seeding &&
      sameJson(incoming.config, stage.config) &&
      sameJson(incoming.qualification, stage.qualification) &&
      sameJson(incoming.tiebreakers, stage.tiebreakers);
    if (!unchanged) throw conflict(`A fase "${existing.name}" já começou e não pode mais ser alterada, movida nem removida.`, 'STAGE_LOCKED');
  });
  const keep = new Set(inputs.map((i) => i.id).filter((id): id is string => Boolean(id)));
  await tx.stage.deleteMany({ where: { tournamentId: t.id, status: 'PENDING', id: { notIn: [...keep].filter((id) => current.some((s) => s.id === id)) } } });
  // Ordem é única por campeonato: tira do caminho antes de renumerar.
  await tx.stage.updateMany({ where: { tournamentId: t.id }, data: { order: { increment: 1000 } } });
  const seen = new Set<string>();
  for (const [index, input] of inputs.entries()) {
    const existing = input.id && !seen.has(input.id) ? current.find((s) => s.id === input.id) : undefined;
    const data = {
      order: index + 1,
      name: input.name,
      format: input.format,
      scoringModelId: input.scoringModelId,
      config: input.config as Prisma.InputJsonValue,
      qualification: (input.qualification ?? undefined) as Prisma.InputJsonValue | undefined,
      tiebreakers: input.tiebreakers,
      seeding: input.seeding,
    };
    if (existing) {
      seen.add(existing.id);
      await tx.stage.update({ where: { id: existing.id }, data: { ...data, qualification: input.qualification === null ? Prisma.DbNull : data.qualification } });
    } else {
      await tx.stage.create({ data: { ...data, tournamentId: t.id } });
    }
  }
}

/** Monta o `update` com os campos presentes no corpo (ausente = não muda) e grava as fases. */
async function applyDraft(tx: Prisma.TransactionClient, t: TournamentRow, raw: TournamentDraftInput): Promise<void> {
  const input = sanitizeTournamentHtml(raw);
  const data: Prisma.TournamentUncheckedUpdateInput = {};

  if (input.gameId !== undefined || input.gameModeId !== undefined) {
    const gameId = input.gameId ?? t.gameId;
    let gameModeId = input.gameModeId ?? t.gameModeId;
    // Trocou o jogo sem informar o modo: cai no primeiro modo do jogo novo.
    if (input.gameId !== undefined && input.gameModeId === undefined && gameId !== t.gameId) {
      gameModeId = (await tx.gameMode.findFirst({ where: { gameId }, orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id ?? gameModeId;
    }
    const { mode } = await requireGameAndMode(tx, gameId, gameModeId);
    Object.assign(data, { gameId, gameModeId, participantType: mode.teamSize > 1 ? 'TEAM' : 'SOLO' });
  }
  if (input.name !== undefined && input.name.trim() !== t.name) {
    data.name = input.name.trim();
    // O endereço público só muda enquanto é rascunho: depois de publicado, o link já circulou.
    if (t.status === 'DRAFT') data.slug = await uniqueSlug(tx, data.name, t.id);
  }
  if (input.description !== undefined) data.description = input.description;
  if (input.rules !== undefined) data.rules = input.rules;
  if (input.prize !== undefined) data.prize = input.prize;
  if (input.bannerUrl !== undefined) data.bannerUrl = input.bannerUrl;
  if (input.streamUrls !== undefined) data.streamUrls = input.streamUrls;
  if (input.maxParticipants !== undefined) data.maxParticipants = input.maxParticipants;
  if (input.registrationOpensAt !== undefined) data.registrationOpensAt = date(input.registrationOpensAt);
  if (input.registrationClosesAt !== undefined) data.registrationClosesAt = date(input.registrationClosesAt);
  if (input.startsAt !== undefined) data.startsAt = date(input.startsAt);
  if (input.manualApproval !== undefined) data.manualApproval = input.manualApproval;
  if (input.waitlistEnabled !== undefined) data.waitlistEnabled = input.waitlistEnabled;
  if (input.checkIn !== undefined) data.checkInConfig = input.checkIn;
  if (input.rosterLockAt !== undefined) data.rosterLockAt = date(input.rosterLockAt);
  if (input.draftStep !== undefined && t.status === 'DRAFT') data.draftStep = input.draftStep;

  await tx.tournament.update({ where: { id: t.id }, data });
  if (input.stages !== undefined) await writeStages(tx, t, input.stages);
}

/** Jogo padrão de um rascunho novo: o primeiro ativo e liberado para a conta. */
async function defaultGameFor(db: Db, userId: string): Promise<{ gameId: string; gameModeId: string }> {
  const limits = await limitsOf(db, userId);
  const games = await db.game.findMany({ where: { active: true }, include: { modes: { orderBy: { createdAt: 'asc' } } }, orderBy: { name: 'asc' } });
  const game = games.find((g) => g.modes.length > 0 && isGameAllowed(limits, g.id));
  if (!game?.modes[0]) throw conflict('Não há jogo disponível para a sua conta. Fale com a administração da Nova Arena.', 'NO_GAME_AVAILABLE');
  return { gameId: game.id, gameModeId: game.modes[0].id };
}

async function createTournament(tx: Prisma.TransactionClient, ownerId: string, name: string, gameId: string, gameModeId: string, extra: Prisma.TournamentUncheckedCreateInput | object = {}) {
  const { mode } = await requireGameAndMode(tx, gameId, gameModeId);
  return tx.tournament.create({
    data: {
      slug: await uniqueSlug(tx, name),
      name,
      gameId,
      gameModeId,
      ownerId,
      status: 'DRAFT',
      participantType: mode.teamSize > 1 ? 'TEAM' : 'SOLO',
      maxParticipants: mode.matchType === 'BATTLE_ROYALE' ? 48 : 16,
      checkInConfig: { enabled: true, opensMinutesBefore: 30, closesMinutesBefore: 10, requireAllMembers: false },
      draftStep: 0,
      ...extra,
    },
    include: tournamentInclude,
  });
}

// ── Rotas ────────────────────────────────────────────────────────────
export const tournaments = new Hono<AppEnv>();

/** Campeonatos em que sou responsável ou co-organizador (o Admin vê os próprios aqui; a visão global é do painel Admin). */
tournaments.get('/organizer/tournaments', async (c) => {
  await assertRole(c, ORGANIZER_AREA_ROLES);
  const session = await requireSession(c);
  const db = c.get('deps').db();
  const rows = await db.tournament.findMany({
    where: { OR: [{ ownerId: session.userId }, { staff: { some: { userId: session.userId, role: 'CO_ORGANIZER' } } }] },
    include: tournamentInclude,
    orderBy: { updatedAt: 'desc' },
  });
  const counts = await countsOf(db, rows.map((t) => t.id));
  return respond(
    c,
    z.array(OrganizerTournament),
    rows.map((t) => toOrganizerTournament(t, t.ownerId === session.userId ? 'OWNER' : 'CO_ORGANIZER', counts.get(t.id))),
  );
});

/** Detalhe para quem organiza. 403 para quem não é da organização (mesmo que o campeonato seja público). */
tournaments.get('/organizer/tournaments/:id', async (c) => {
  const db = c.get('deps').db();
  const t = await loadTournament(db, c.req.param('id'));
  return detail(c, db, t.id, await accessTo(c, t, 'moderate'));
});

// ── Modelos de campeonato ──
const toTemplate = (t: { id: string; ownerId: string | null; name: string; description: string; gameId: string; gameModeId: string; payload: unknown }): TournamentTemplate => ({
  id: t.id,
  ownerId: t.ownerId,
  name: t.name,
  description: t.description,
  gameId: t.gameId,
  gameModeId: t.gameModeId,
  payload: TournamentDraftInput.catch({}).parse(t.payload),
});

async function visibleTemplate(c: AppContext, id: string) {
  const session = await requireSession(c);
  const template = isUuid(id) ? await c.get('deps').db().tournamentTemplate.findUnique({ where: { id } }) : null;
  if (!template || (template.ownerId !== null && template.ownerId !== session.userId && !isAdmin(await currentRoles(c)))) throw notFound('Modelo');
  return template;
}

tournaments.get('/tournament-templates', async (c) => {
  await assertRole(c, ORGANIZER_AREA_ROLES);
  const session = await requireSession(c);
  const rows = await c.get('deps').db().tournamentTemplate.findMany({ where: { OR: [{ ownerId: null }, { ownerId: session.userId }] } });
  rows.sort((a, b) => Number(a.ownerId !== null) - Number(b.ownerId !== null) || a.name.localeCompare(b.name, 'pt-BR'));
  return respond(c, z.array(TournamentTemplate), rows.map(toTemplate));
});

tournaments.post('/tournament-templates', async (c) => {
  await assertRole(c, ORGANIZER_AREA_ROLES);
  const session = await requireSession(c);
  const input = await body(c, SaveTemplateInput);
  const db = c.get('deps').db();
  const t = await loadTournament(db, input.tournamentId);
  await accessTo(c, t);
  if (t.stages.length === 0) throw conflict('Este campeonato ainda não tem fases. Monte as fases antes de salvar como modelo.', 'TEMPLATE_WITHOUT_STAGES');
  const mine = await db.tournamentTemplate.findMany({ where: { ownerId: session.userId }, select: { name: true } });
  if (mine.some((x) => x.name.toLowerCase() === input.name.toLowerCase())) {
    throw new HttpProblem(409, 'Você já tem um modelo com este nome.', 'TEMPLATE_NAME_TAKEN', { name: 'Você já tem um modelo com este nome.' });
  }
  const draft = toDraft(t);
  // Modelo guarda a estrutura, não a identidade: sem nome, datas, banner nem links.
  const payload: TournamentDraftInput = {
    gameId: t.gameId,
    gameModeId: t.gameModeId,
    maxParticipants: t.maxParticipants,
    manualApproval: t.manualApproval,
    waitlistEnabled: t.waitlistEnabled,
    checkIn: draft.checkIn,
    description: t.description,
    rules: t.rules,
    prize: t.prize,
    stages: draft.stages.map((s) => ({ ...s, id: undefined })),
  };
  const template = await db.tournamentTemplate.create({ data: { ownerId: session.userId, name: input.name, description: input.description, gameId: t.gameId, gameModeId: t.gameModeId, payload: payload as Prisma.InputJsonValue } });
  return respond(c, TournamentTemplate, toTemplate(template), 201);
});

tournaments.delete('/tournament-templates/:id', async (c) => {
  await assertRole(c, ORGANIZER_AREA_ROLES);
  const session = await requireSession(c);
  const template = await visibleTemplate(c, c.req.param('id'));
  if (template.ownerId !== session.userId) throw forbidden(template.ownerId === null ? 'Os modelos da plataforma não podem ser excluídos.' : 'Você só pode excluir os seus modelos.');
  await c.get('deps').db().tournamentTemplate.delete({ where: { id: template.id } });
  return c.body(null, 204);
});

// ── Modelo de pontuação personalizado (opção "personalizar" da fase) ──
const toModel = (m: { id: string; gameId: string; name: string; matchType: ScoringModel['matchType']; rules: unknown; tiebreakers: unknown; isDefault: boolean; ownerId: string | null }): ScoringModel => ({
  id: m.id,
  gameId: m.gameId,
  name: m.name,
  matchType: m.matchType,
  rules: m.rules as ScoringModel['rules'],
  tiebreakers: m.tiebreakers as ScoringModel['tiebreakers'],
  isDefault: m.isDefault,
  ownerId: m.ownerId,
});

function assertCustomModel(input: { name: string; matchType: ScoringModel['matchType']; rules: ScoringModel['rules']; tiebreakers: ScoringModel['tiebreakers'] }) {
  const errors = validateScoringDraft(input);
  if (errors.length > 0) throw new HttpProblem(400, errors.join(' '), 'INVALID_SCORING_MODEL', scoringFieldErrors(errors));
}

tournaments.post('/organizer/scoring-models', async (c) => {
  await assertRole(c, ORGANIZER_AREA_ROLES);
  const session = await requireSession(c);
  const input = await body(c, CustomScoringModelInput);
  const db = c.get('deps').db();
  if (!(await db.game.findUnique({ where: { id: input.gameId }, select: { id: true } }))) throw notFound('Jogo');
  assertCustomModel(input);
  const model = await db.scoringModel.create({ data: { gameId: input.gameId, name: input.name, matchType: input.matchType, rules: input.rules as Prisma.InputJsonValue, tiebreakers: input.tiebreakers, isDefault: false, ownerId: session.userId } });
  return respond(c, ScoringModel, toModel(model), 201);
});

tournaments.put('/organizer/scoring-models/:id', async (c) => {
  await assertRole(c, ORGANIZER_AREA_ROLES);
  const session = await requireSession(c);
  const input = await body(c, CustomScoringModelInput);
  const db = c.get('deps').db();
  const id = c.req.param('id');
  const model = isUuid(id) ? await db.scoringModel.findUnique({ where: { id } }) : null;
  if (!model) throw notFound('Modelo de pontuação');
  if (model.ownerId !== session.userId) throw forbidden('Você só pode alterar os modelos de pontuação que criou.');
  // RN-02: mudar a pontuação de uma fase que já começou é outro fluxo (com recálculo e auditoria).
  if (await db.stage.count({ where: { scoringModelId: id, status: { not: 'PENDING' } } })) throw conflict('Este modelo é usado por uma fase que já começou e não pode ser alterado aqui.', 'SCORING_MODEL_IN_USE');
  assertCustomModel(input);
  const saved = await db.scoringModel.update({ where: { id }, data: { name: input.name, matchType: input.matchType, rules: input.rules as Prisma.InputJsonValue, tiebreakers: input.tiebreakers } });
  return respond(c, ScoringModel, toModel(saved));
});

// ── Rascunho ──
tournaments.post('/tournaments', async (c) => {
  await assertRole(c, ORGANIZER_AREA_ROLES);
  const session = await requireSession(c);
  const { templateId, ...input } = await body(c, CreateTournamentInput);
  const template = templateId ? await visibleTemplate(c, templateId) : null;
  // O que veio no corpo vale mais que o modelo.
  const merged: TournamentDraftInput = { ...(template ? toTemplate(template).payload : {}), ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };
  const db = c.get('deps').db();
  const fallback = merged.gameId ? null : await defaultGameFor(db, session.userId);
  const gameId = merged.gameId ?? fallback?.gameId ?? '';
  const gameModeId = merged.gameModeId ?? fallback?.gameModeId ?? (await db.gameMode.findFirst({ where: { gameId }, orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id ?? '';
  // Jogo desativado não entra em campeonato novo (#74).
  const game = await db.game.findUnique({ where: { id: gameId }, select: { active: true } });
  if (game && !game.active) throw badRequest('Confira os campos destacados.', 'VALIDATION', { gameId: 'Este jogo está desativado no catálogo.' });

  const created = await db.$transaction(async (tx) => {
    const t = await createTournament(tx, session.userId, merged.name?.trim() || UNNAMED_TOURNAMENT, gameId, gameModeId);
    await applyDraft(tx, t, { ...merged, gameId: undefined, gameModeId: undefined, name: undefined });
    return t.id;
  });
  return detail(c, db, created, isAdmin(await currentRoles(c)) ? 'ADMIN' : 'OWNER', 201);
});

tournaments.patch('/tournaments/:id', async (c) => {
  const db = c.get('deps').db();
  const t = await loadTournament(db, c.req.param('id'));
  const access = await accessTo(c, t);
  const input = await body(c, TournamentDraftInput);
  if (READ_ONLY.includes(t.status)) throw conflict('Este campeonato já foi encerrado e não pode mais ser editado.', 'TOURNAMENT_READ_ONLY');

  if (t.status === 'DRAFT') {
    await db.$transaction((tx) => applyDraft(tx, t, input));
    return detail(c, db, t.id, access);
  }

  // Publicado: o jogo não muda mais, as inscrições só mudam antes de começar e o resultado precisa continuar válido.
  if ((input.gameId !== undefined && input.gameId !== t.gameId) || (input.gameModeId !== undefined && input.gameModeId !== t.gameModeId)) {
    throw conflict('O jogo e o modo não podem mudar depois que o campeonato é publicado.', 'GAME_LOCKED');
  }
  if (STARTED.includes(t.status)) {
    const changed =
      (input.maxParticipants !== undefined && input.maxParticipants !== t.maxParticipants) ||
      (input.registrationOpensAt !== undefined && input.registrationOpensAt !== iso(t.registrationOpensAt)) ||
      (input.registrationClosesAt !== undefined && input.registrationClosesAt !== iso(t.registrationClosesAt)) ||
      (input.startsAt !== undefined && input.startsAt !== iso(t.startsAt));
    if (changed) throw conflict('Vagas e datas não podem mudar com o campeonato em andamento.', 'REGISTRATION_LOCKED');
  }
  const counts = (await countsOf(db, [t.id])).get(t.id);
  const ctx = await auditCtx(c);
  await withAudit(db, ctx, async (tx) => {
    await applyDraft(tx, t, input);
    const next = await loadTournament(tx, t.id);
    // Só barra o que esta edição toca: uma pendência antiga em outro campo (ex.: o jogo saiu do catálogo)
    // não pode impedir a organização de corrigir o regulamento ou a premiação.
    const touched = new Set(Object.entries(input).filter(([, value]) => value !== undefined).map(([key]) => key));
    const dates = ['registrationOpensAt', 'registrationClosesAt', 'startsAt', 'rosterLockAt'];
    const issues = validateDraft(toDraft(next), { games: await gamesFor(tx, [t.ownerId, ctx.actorId]), now: c.get('deps').now(), alreadyPublished: true, takenSlots: counts?.takenSlots ?? 0 }).filter((issue) => {
      const root = issue.field.split('.')[0] ?? '';
      if (touched.has(root)) return true;
      if (root === 'stages') return touched.has('maxParticipants');
      return dates.includes(root) && dates.some((field) => touched.has(field));
    });
    if (issues.length > 0) throw badRequest(issues[0]?.message ?? 'Confira os campos destacados.', 'VALIDATION', issuesToErrors(issues));
    await audited(tx, { action: 'TOURNAMENT_UPDATED', entityType: 'Tournament', entityId: t.id, entityLabel: next.name, tournamentId: t.id, after: { campos: [...touched] } });
  });
  return detail(c, db, t.id, access);
});

tournaments.delete('/tournaments/:id', async (c) => {
  const db = c.get('deps').db();
  const t = await loadTournament(db, c.req.param('id'));
  await ownerAccess(c, t, 'excluir o rascunho');
  if (t.status !== 'DRAFT') throw conflict('Só rascunhos podem ser excluídos. Um campeonato publicado precisa ser cancelado.', 'NOT_A_DRAFT');
  await db.tournament.delete({ where: { id: t.id } });
  return c.body(null, 204);
});

// ── Ciclo de vida (PRD §8.3) ──
/** Muda o status com auditoria na mesma transação. */
async function changeStatus(c: AppContext, t: TournamentRow, to: TournamentStatus, extra: Prisma.TournamentUncheckedUpdateInput, reason: string | null, action: 'TOURNAMENT_STATUS_CHANGED' | 'TOURNAMENT_PUBLISHED' = 'TOURNAMENT_STATUS_CHANGED') {
  const db = c.get('deps').db();
  await withAudit(db, { ...(await auditCtx(c)), reason }, async (tx) => {
    // Corrida entre dois cliques: só muda se o status ainda é o que lemos.
    const { count } = await tx.tournament.updateMany({ where: { id: t.id, status: t.status }, data: { ...extra, status: to } });
    if (count === 0) throw conflict('O status do campeonato mudou enquanto você agia. Atualize a página.', 'INVALID_TRANSITION');
    await audited(tx, { action, entityType: 'Tournament', entityId: t.id, entityLabel: t.name, tournamentId: t.id, before: { status: t.status }, after: { status: to } });
  });
}

tournaments.post('/tournaments/:id/publish', async (c) => {
  const db = c.get('deps').db();
  const t = await loadTournament(db, c.req.param('id'));
  const access = await ownerAccess(c, t, 'publicar');
  if (!canTransition(t.status, 'PUBLISHED')) throw conflict('Este campeonato já foi publicado.', 'INVALID_TRANSITION');

  const now = c.get('deps').now();
  const session = await requireSession(c);
  const issues = validateDraft(toDraft(t), { games: await gamesFor(db, [t.ownerId, session.userId]), now });
  if (issues.length > 0) {
    const n = issues.length;
    throw badRequest(`Ainda ${n === 1 ? 'falta 1 ponto' : `faltam ${n} pontos`} para publicar. Confira a revisão.`, 'INCOMPLETE', issuesToErrors(issues));
  }

  // RN-10: o limite é do responsável pelo campeonato e só é conferido ao publicar.
  const others = await db.tournament.findMany({ where: { ownerId: t.ownerId, id: { not: t.id } }, select: { ownerId: true, status: true } });
  const check = checkOrganizerLimits(await limitsOf(db, t.ownerId), { activeCount: countActiveTournaments(others, t.ownerId), gameId: t.gameId, gameName: t.game.name });
  if (!check.ok) throw new HttpProblem(check.code === 'GAME_NOT_ALLOWED' ? 403 : 409, check.message, check.code);

  // Sem data de abertura (ou com data já passada), as inscrições abrem na hora.
  const opensNow = t.registrationOpensAt === null || t.registrationOpensAt.getTime() <= now.getTime();
  await changeStatus(c, t, opensNow ? 'REGISTRATION_OPEN' : 'PUBLISHED', { draftStep: 6, ...(opensNow && t.registrationOpensAt === null ? { registrationOpensAt: now } : {}) }, null, 'TOURNAMENT_PUBLISHED');
  return detail(c, db, t.id, access);
});

tournaments.post('/tournaments/:id/open-registration', async (c) => {
  const db = c.get('deps').db();
  const t = await loadTournament(db, c.req.param('id'));
  const access = await accessTo(c, t);
  if (!canTransition(t.status, 'REGISTRATION_OPEN')) throw conflict('As inscrições só podem ser abertas em um campeonato publicado que ainda não abriu.', 'INVALID_TRANSITION');
  const now = c.get('deps').now();
  if (t.registrationClosesAt !== null && t.registrationClosesAt.getTime() <= now.getTime()) {
    throw conflict('O prazo de inscrição já passou. Ajuste a data de fechamento antes de abrir.', 'REGISTRATION_DEADLINE_PASSED');
  }
  await changeStatus(c, t, 'REGISTRATION_OPEN', { registrationOpensAt: now }, null);
  return detail(c, db, t.id, access);
});

tournaments.post('/tournaments/:id/close-registration', async (c) => {
  const db = c.get('deps').db();
  const t = await loadTournament(db, c.req.param('id'));
  const access = await accessTo(c, t);
  if (!canTransition(t.status, 'REGISTRATION_CLOSED')) throw conflict('As inscrições só podem ser encerradas enquanto estão abertas.', 'INVALID_TRANSITION');
  const now = c.get('deps').now();
  await changeStatus(c, t, 'REGISTRATION_CLOSED', t.registrationClosesAt === null || t.registrationClosesAt.getTime() > now.getTime() ? { registrationClosesAt: now } : {}, null);
  return detail(c, db, t.id, access);
});

tournaments.post('/tournaments/:id/cancel', async (c) => {
  const db = c.get('deps').db();
  const t = await loadTournament(db, c.req.param('id'));
  const access = await ownerAccess(c, t, 'cancelar');
  const { reason } = await body(c, CancelTournamentInput);
  if (!canTransition(t.status, 'CANCELLED')) {
    throw conflict(t.status === 'CANCELLED' ? 'Este campeonato já está cancelado.' : 'Este campeonato não pode ser cancelado no estado atual. Em andamento, pause antes de cancelar.', 'INVALID_TRANSITION');
  }
  await changeStatus(c, t, 'CANCELLED', { statusReason: reason }, reason);
  return detail(c, db, t.id, access);
});

tournaments.post('/tournaments/:id/pause', async (c) => {
  const db = c.get('deps').db();
  const t = await loadTournament(db, c.req.param('id'));
  const access = await accessTo(c, t);
  const { reason } = await body(c, PauseTournamentInput);
  if (!canTransition(t.status, 'PAUSED')) throw conflict(t.status === 'PAUSED' ? 'Este campeonato já está pausado.' : 'Só um campeonato em andamento pode ser pausado.', 'INVALID_TRANSITION');
  await changeStatus(c, t, 'PAUSED', { statusReason: reason }, reason);
  return detail(c, db, t.id, access);
});

tournaments.post('/tournaments/:id/resume', async (c) => {
  const db = c.get('deps').db();
  const t = await loadTournament(db, c.req.param('id'));
  const access = await accessTo(c, t);
  const { reason } = await body(c, ResumeTournamentInput);
  if (t.status !== 'PAUSED' || !canTransition(t.status, 'IN_PROGRESS')) throw conflict('Só um campeonato pausado pode ser retomado.', 'INVALID_TRANSITION');
  await changeStatus(c, t, 'IN_PROGRESS', { statusReason: null }, reason || null);
  return detail(c, db, t.id, access);
});

tournaments.post('/tournaments/:id/archive', async (c) => {
  const db = c.get('deps').db();
  const t = await loadTournament(db, c.req.param('id'));
  const access = await accessTo(c, t);
  if (!canTransition(t.status, 'ARCHIVED')) throw conflict(t.status === 'ARCHIVED' ? 'Este campeonato já está arquivado.' : 'Só um campeonato finalizado pode ser arquivado.', 'INVALID_TRANSITION');
  await changeStatus(c, t, 'ARCHIVED', {}, null);
  return detail(c, db, t.id, access);
});

tournaments.post('/tournaments/:id/duplicate', async (c) => {
  await assertRole(c, ORGANIZER_AREA_ROLES);
  const session = await requireSession(c);
  const db = c.get('deps').db();
  const source = await loadTournament(db, c.req.param('id'));
  await accessTo(c, source);
  const now = c.get('deps').now().getTime();
  // Datas que já passaram não servem para a cópia.
  const future = (d: Date | null) => (d !== null && d.getTime() > now ? d : null);
  const base = source.name === UNNAMED_TOURNAMENT ? UNNAMED_TOURNAMENT : `Cópia de ${source.name}`.slice(0, 80);
  const draft = toDraft(source);
  const id = await db.$transaction(async (tx) => {
    const t = await createTournament(tx, session.userId, base, source.gameId, source.gameModeId, {
      maxParticipants: source.maxParticipants,
      description: source.description,
      rules: source.rules,
      prize: source.prize,
      bannerUrl: source.bannerUrl,
      streamUrls: [...source.streamUrls],
      manualApproval: source.manualApproval,
      waitlistEnabled: source.waitlistEnabled,
      checkInConfig: draft.checkIn,
      registrationOpensAt: future(source.registrationOpensAt),
      registrationClosesAt: future(source.registrationClosesAt),
      startsAt: future(source.startsAt),
      rosterLockAt: future(source.rosterLockAt),
    });
    await writeStages(tx, t, draft.stages.map((s) => ({ ...s, id: undefined })));
    return t.id;
  });
  return detail(c, db, id, 'OWNER', 201);
});

// ── Equipe do evento (ORG-10) ──
type StaffRow = { userId: string; role: 'CO_ORGANIZER' | 'MODERATOR'; createdAt: Date; user: { nickname: string; avatarUrl: string | null } };
const toStaff = (s: StaffRow): TournamentStaff => ({ userId: s.userId, nickname: s.user.nickname, avatarUrl: s.user.avatarUrl, role: s.role, addedAt: s.createdAt.toISOString() });
const staffUser = { user: { select: { nickname: true, avatarUrl: true } } } as const;

tournaments.get('/tournaments/:id/staff', async (c) => {
  const db = c.get('deps').db();
  const t = await loadTournament(db, c.req.param('id'));
  await accessTo(c, t, 'moderate');
  const rows = await db.tournamentStaff.findMany({ where: { tournamentId: t.id }, include: staffUser, orderBy: { createdAt: 'asc' } });
  return respond(c, z.array(TournamentStaff), rows.map(toStaff));
});

tournaments.post('/tournaments/:id/staff', async (c) => {
  const db = c.get('deps').db();
  const t = await loadTournament(db, c.req.param('id'));
  await ownerAccess(c, t, 'mudar a equipe do evento');
  const input = await body(c, StaffInput);
  if (CLOSED_FOR_STAFF.includes(t.status)) throw conflict('Este campeonato já foi encerrado: a equipe do evento não muda mais.', 'TOURNAMENT_READ_ONLY');

  const target = await db.user.findUnique({ where: { nicknameKey: input.nickname.replace(/^@/, '').toLowerCase() } });
  if (!target || target.status === 'DELETED' || target.status === 'MERGED') throw new HttpProblem(404, 'Não encontramos ninguém com este apelido.', 'USER_NOT_FOUND', { nickname: 'Não encontramos ninguém com este apelido' });
  if (target.status !== 'ACTIVE') throw conflict(`${target.nickname} está com a conta suspensa ou banida e não pode entrar na equipe.`, 'USER_NOT_ACTIVE');
  if (target.id === t.ownerId) throw conflict(`${target.nickname} já é responsável por este campeonato.`, 'ALREADY_OWNER');
  if (await db.tournamentStaff.findUnique({ where: { tournamentId_userId: { tournamentId: t.id, userId: target.id } } })) throw conflict(`${target.nickname} já faz parte da equipe do evento.`, 'ALREADY_STAFF');
  // PRD §6, nota ³: quem organiza não joga o próprio campeonato — e quem joga não organiza.
  const registered = await db.registration.count({
    where: { tournamentId: t.id, status: { in: ['PENDING_MEMBERS', 'PENDING_APPROVAL', 'CONFIRMED', 'WAITLIST'] }, OR: [{ userId: target.id }, { members: { some: { userId: target.id } } }] },
  });
  if (registered > 0) throw conflict(`${target.nickname} está inscrito neste campeonato. Quem joga não pode fazer parte da equipe do evento.`, 'STAFF_IS_REGISTERED');

  const ctx = await auditCtx(c);
  const entry = await withAudit(db, ctx, async (tx) => {
    const created = await tx.tournamentStaff.create({ data: { tournamentId: t.id, userId: target.id, role: input.role, addedById: ctx.actorId }, include: staffUser });
    await audited(tx, { action: 'STAFF_CHANGED', entityType: 'Tournament', entityId: t.id, entityLabel: t.name, tournamentId: t.id, after: { adicionou: target.nickname, papel: ROLE_LABEL[input.role] } });
    return created;
  });
  return respond(c, TournamentStaff, toStaff(entry), 201);
});

async function staffEntry(db: Db, tournamentId: string, userId: string) {
  const entry = isUuid(userId) ? await db.tournamentStaff.findUnique({ where: { tournamentId_userId: { tournamentId, userId } }, include: staffUser }) : null;
  if (!entry) throw notFound('Membro da equipe');
  return entry;
}

tournaments.patch('/tournaments/:id/staff/:userId', async (c) => {
  const db = c.get('deps').db();
  const t = await loadTournament(db, c.req.param('id'));
  await ownerAccess(c, t, 'mudar a equipe do evento');
  const input = await body(c, StaffRoleInput);
  const entry = await staffEntry(db, t.id, c.req.param('userId'));
  if (entry.role === input.role) return respond(c, TournamentStaff, toStaff(entry));
  const updated = await withAudit(db, await auditCtx(c), async (tx) => {
    const saved = await tx.tournamentStaff.update({ where: { tournamentId_userId: { tournamentId: t.id, userId: entry.userId } }, data: { role: input.role }, include: staffUser });
    await audited(tx, { action: 'STAFF_CHANGED', entityType: 'Tournament', entityId: t.id, entityLabel: t.name, tournamentId: t.id, before: { membro: entry.user.nickname, papel: ROLE_LABEL[entry.role] }, after: { membro: entry.user.nickname, papel: ROLE_LABEL[input.role] } });
    return saved;
  });
  return respond(c, TournamentStaff, toStaff(updated));
});

tournaments.delete('/tournaments/:id/staff/:userId', async (c) => {
  const db = c.get('deps').db();
  const t = await loadTournament(db, c.req.param('id'));
  await ownerAccess(c, t, 'mudar a equipe do evento');
  const entry = await staffEntry(db, t.id, c.req.param('userId'));
  await withAudit(db, await auditCtx(c), async (tx) => {
    await tx.tournamentStaff.delete({ where: { tournamentId_userId: { tournamentId: t.id, userId: entry.userId } } });
    await audited(tx, { action: 'STAFF_CHANGED', entityType: 'Tournament', entityId: t.id, entityLabel: t.name, tournamentId: t.id, before: { membro: entry.user.nickname, papel: ROLE_LABEL[entry.role] }, after: { removeu: entry.user.nickname } });
  });
  return c.body(null, 204);
});
