/**
 * Módulo `tournaments-manage` da API simulada: área do organizador (F1.6).
 * Criação e edição do rascunho, ciclo de vida (PRD §8.3), modelos de campeonato e modelos
 * de pontuação personalizados. As regras são as mesmas que a API real terá em B1:
 * permissões do PRD §6, máquina de estados de `canTransition` e limites da RN-10.
 */
import { http } from 'msw';
import {
  ACTIVE_TOURNAMENT_STATUSES,
  CancelTournamentInput,
  canTransition,
  CreateTournamentInput,
  CustomScoringModelInput,
  SaveTemplateInput,
  TournamentDraftInput,
  type Announcement,
  type OrganizerTournament,
  type OrganizerTournamentDetail,
  type ScoringModel,
  type Stage,
  type StageInput,
  type TournamentStatus,
  type TournamentTemplate,
} from '@nova/schemas';
import { EngineError, generateStage, validateScoringModel } from '@nova/engine';
import { UNNAMED_TOURNAMENT } from '@/features/organizer/lib/draft';
import { checkOrganizerLimits, countActiveTournaments, isGameAllowed, type OrganizerForLimits } from '@/features/organizer/lib/limits';
import { sanitizeTournamentHtml } from '@/features/organizer/lib/sanitize-html';
import { validateDraft, type DraftForValidation, type DraftIssue } from '@/features/organizer/validation';
import { audit } from '../audit';
import { getRun, newRun, putRun, removeRun, toEngineConfig } from '../competition';
import { collection, db, nowIso, save, uid, uniqueSlug, type DbTemplate, type DbTournament, type DbUser } from '../db';
import {
  badRequest,
  body,
  conflict,
  findTournament,
  forbidden,
  handle,
  HttpProblem,
  isAdmin,
  json,
  noContent,
  notFound,
  param,
  requireRole,
  requireTournamentAccess,
  requireUser,
  tournamentAccess,
  url,
  type TournamentAccess,
} from '../http';
import { takenSlots, toTournament, toTournamentSummary } from '../views';

export const moduleName = 'tournaments-manage';

const UNNAMED = UNNAMED_TOURNAMENT;
const READ_ONLY: TournamentStatus[] = ['FINISHED', 'ARCHIVED', 'CANCELLED'];
const STARTED: TournamentStatus[] = ['IN_PROGRESS', 'PAUSED'];

interface Cancellation {
  tournamentId: string;
  reason: string;
  byUserId: string;
  at: string;
}
const cancellations = () => collection<Cancellation>('tournamentCancellations');

/** Pausas do campeonato (F2.3). A pausa em vigor é a que ainda não tem `resumedAt`. */
export interface TournamentPause {
  tournamentId: string;
  reason: string;
  byUserId: string;
  at: string;
  resumedAt: string | null;
}
export const tournamentPauses = () => collection<TournamentPause>('tournamentPauses');

// ── Conversões ───────────────────────────────────────────────────────
function pendingApprovals(tournamentId: string): number {
  return db().registrations.filter((r) => r.tournamentId === tournamentId && r.status === 'PENDING_APPROVAL').length;
}
function waitlistCount(tournamentId: string): number {
  return db().registrations.filter((r) => r.tournamentId === tournamentId && r.status === 'WAITLIST').length;
}

function toOrganizerTournament(t: DbTournament, access: TournamentAccess): OrganizerTournament {
  return { ...toTournamentSummary(t), access, draftStep: t.draftStep, pendingApprovals: pendingApprovals(t.id), waitlistCount: waitlistCount(t.id), stageCount: t.stages.length };
}

export function toOrganizerDetail(t: DbTournament, access: TournamentAccess): OrganizerTournamentDetail {
  return {
    ...toTournament(t),
    access,
    pendingApprovals: pendingApprovals(t.id),
    cancelReason: cancellations().find((c) => c.tournamentId === t.id)?.reason ?? null,
    pauseReason: t.status === 'PAUSED' ? (tournamentPauses().find((p) => p.tournamentId === t.id && p.resumedAt === null)?.reason ?? null) : null,
  };
}

function toStageInput(s: Stage): StageInput {
  return { id: s.id, name: s.name, format: s.format, scoringModelId: s.scoringModelId, config: s.config, qualification: s.qualification, tiebreakers: s.tiebreakers, seeding: s.seeding };
}

function toDraft(t: DbTournament): DraftForValidation {
  return {
    name: t.name === UNNAMED ? '' : t.name,
    description: t.description,
    rules: t.rules,
    prize: t.prize,
    streamUrls: t.streamUrls,
    gameId: t.gameId,
    gameModeId: t.gameModeId,
    maxParticipants: t.maxParticipants,
    registrationOpensAt: t.registrationOpensAt,
    registrationClosesAt: t.registrationClosesAt,
    startsAt: t.startsAt,
    rosterLockAt: t.rosterLockAt,
    checkIn: t.checkIn,
    stages: [...t.stages].sort((a, b) => a.order - b.order).map(toStageInput),
  };
}

function toTemplate(t: DbTemplate): TournamentTemplate {
  return { id: t.id, ownerId: t.ownerId, name: t.name, description: t.description, gameId: t.gameId, gameModeId: t.gameModeId, payload: t.payload };
}

/** Uma mensagem por campo, no formato de erros da API. */
function issuesToErrors(issues: DraftIssue[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) errors[issue.field] ??= issue.message;
  return errors;
}

function limitsOf(user: DbUser): OrganizerForLimits {
  return { isAdmin: isAdmin(user), verifiedOrganizer: user.verifiedOrganizer, organizerLimits: user.organizerLimits };
}

// ── Regras ───────────────────────────────────────────────────────────
/** Publicar, cancelar e excluir são do responsável pelo campeonato (ou do Admin). Co-organizador edita e opera. */
function requireOwner(t: DbTournament, what: string): { user: DbUser; access: TournamentAccess } {
  const result = requireTournamentAccess(t);
  if (result.access === 'CO_ORGANIZER') throw forbidden(`Só quem é responsável pelo campeonato pode ${what}.`);
  return result;
}

function requireGameAndMode(gameId: string, gameModeId: string) {
  const game = db().games.find((g) => g.id === gameId);
  if (!game) throw badRequest('Confira os campos destacados.', 'VALIDATION', { gameId: 'Este jogo não existe no catálogo.' });
  const mode = game.modes.find((m) => m.id === gameModeId);
  if (!mode) throw badRequest('Confira os campos destacados.', 'VALIDATION', { gameModeId: `Este modo não existe em ${game.name}.` });
  return { game, mode };
}

/** Jogo padrão de um rascunho novo: o primeiro ativo e liberado para a conta. */
function defaultGameFor(user: DbUser) {
  const game = db().games.find((g) => g.active && g.modes.length > 0 && isGameAllowed(limitsOf(user), g.id));
  if (!game?.modes[0]) throw conflict('Não há jogo disponível para a sua conta. Fale com a administração da Nova Arena.', 'NO_GAME_AVAILABLE');
  return { game, mode: game.modes[0] };
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Aplica a lista de fases vinda da tela. Fase que já começou (`status !== 'PENDING'`) não pode
 * mudar de configuração, de posição nem ser removida (US-ORG-05).
 */
function buildStages(t: DbTournament, inputs: StageInput[]): Stage[] {
  const current = [...t.stages].sort((a, b) => a.order - b.order);
  current.forEach((existing, index) => {
    if (existing.status === 'PENDING') return;
    const incoming = inputs[index];
    const unchanged =
      incoming !== undefined &&
      incoming.id === existing.id &&
      incoming.format === existing.format &&
      incoming.scoringModelId === existing.scoringModelId &&
      incoming.seeding === existing.seeding &&
      sameJson(incoming.config, existing.config) &&
      sameJson(incoming.qualification, existing.qualification) &&
      sameJson(incoming.tiebreakers, existing.tiebreakers);
    if (!unchanged) throw conflict(`A fase "${existing.name}" já começou e não pode mais ser alterada, movida nem removida.`, 'STAGE_LOCKED');
  });
  const seen = new Set<string>();
  return inputs.map((input, index) => {
    const existing = input.id && !seen.has(input.id) ? current.find((s) => s.id === input.id) : undefined;
    if (existing) seen.add(existing.id);
    return {
      id: existing?.id ?? uid('st'),
      tournamentId: t.id,
      order: index + 1,
      name: input.name,
      format: input.format,
      scoringModelId: input.scoringModelId,
      config: input.config,
      qualification: input.qualification,
      tiebreakers: input.tiebreakers,
      seeding: input.seeding,
      randomSeed: existing?.randomSeed ?? null,
      status: existing?.status ?? 'PENDING',
      lockedAt: existing?.lockedAt ?? null,
    };
  });
}

/**
 * Uma fase que ainda não começou pode ter uma prévia de chave guardada (gerada pelo organizador ou
 * pelo avanço da fase anterior). Se a configuração dela mudou, a prévia é refeita com os mesmos
 * participantes, para a tela nunca mostrar uma chave do formato antigo (US-ORG-05).
 */
function refreshStalePreviews(before: Stage[], after: Stage[]): void {
  for (const stage of after) {
    if (stage.status !== 'PENDING') continue;
    const old = before.find((s) => s.id === stage.id);
    const run = getRun(stage.id);
    if (!old || !run || run.confirmed) continue;
    if (old.format === stage.format && sameJson(old.config, stage.config) && sameJson(old.qualification, stage.qualification)) continue;
    try {
      const structure = generateStage({ format: stage.format, entrants: run.structure.entrants, config: toEngineConfig(stage), seeding: 'RANKED', seed: run.structure.seedUsed });
      removeRun(stage.id);
      putRun(newRun(stage.id, run.tournamentId, structure, false));
      stage.randomSeed = structure.seedUsed;
    } catch (error) {
      if (!(error instanceof EngineError)) throw error;
      // Na primeira fase basta gerar de novo; nas seguintes os classificados só existem nesta prévia.
      if (stage.order === 1) removeRun(stage.id);
      else throw conflict(`A fase "${stage.name}" já recebeu os classificados e a nova configuração não comporta esses participantes: ${error.message}`, 'STAGE_PREVIEW_CONFLICT');
    }
  }
}

/** Copia para o registro os campos presentes no corpo (ausente = não muda). */
function applyDraft(t: DbTournament, raw: TournamentDraftInput): void {
  const input = sanitizeTournamentHtml(raw);
  const d = db();

  if (input.gameId !== undefined || input.gameModeId !== undefined) {
    const gameId = input.gameId ?? t.gameId;
    let gameModeId = input.gameModeId ?? t.gameModeId;
    // Trocou o jogo sem informar o modo: cai no primeiro modo do jogo novo.
    if (input.gameId !== undefined && input.gameModeId === undefined && gameId !== t.gameId) {
      gameModeId = d.games.find((g) => g.id === gameId)?.modes[0]?.id ?? gameModeId;
    }
    const { mode } = requireGameAndMode(gameId, gameModeId);
    t.gameId = gameId;
    t.gameModeId = gameModeId;
    t.participantType = mode.teamSize > 1 ? 'TEAM' : 'SOLO';
  }
  if (input.name !== undefined && input.name.trim() !== t.name) {
    t.name = input.name.trim();
    // O endereço público só muda enquanto é rascunho: depois de publicado, o link já circulou.
    if (t.status === 'DRAFT') t.slug = uniqueSlug(t.name, (slug) => d.tournaments.some((x) => x.id !== t.id && x.slug === slug));
  }
  if (input.description !== undefined) t.description = input.description;
  if (input.rules !== undefined) t.rules = input.rules;
  if (input.prize !== undefined) t.prize = input.prize;
  if (input.bannerUrl !== undefined) t.bannerUrl = input.bannerUrl;
  if (input.streamUrls !== undefined) t.streamUrls = input.streamUrls;
  if (input.maxParticipants !== undefined) t.maxParticipants = input.maxParticipants;
  if (input.registrationOpensAt !== undefined) t.registrationOpensAt = input.registrationOpensAt;
  if (input.registrationClosesAt !== undefined) t.registrationClosesAt = input.registrationClosesAt;
  if (input.startsAt !== undefined) t.startsAt = input.startsAt;
  if (input.manualApproval !== undefined) t.manualApproval = input.manualApproval;
  if (input.waitlistEnabled !== undefined) t.waitlistEnabled = input.waitlistEnabled;
  if (input.checkIn !== undefined) t.checkIn = input.checkIn;
  if (input.rosterLockAt !== undefined) t.rosterLockAt = input.rosterLockAt;
  if (input.stages !== undefined) t.stages = buildStages(t, input.stages);
  if (input.draftStep !== undefined && t.status === 'DRAFT') t.draftStep = input.draftStep;
  t.updatedAt = nowIso();
}

function newTournament(owner: DbUser, name: string, gameId: string, gameModeId: string): DbTournament {
  const d = db();
  const { mode } = requireGameAndMode(gameId, gameModeId);
  const now = nowIso();
  return {
    id: uid('tn'),
    slug: uniqueSlug(name, (slug) => d.tournaments.some((x) => x.slug === slug)),
    name,
    gameId,
    gameModeId,
    ownerId: owner.id,
    status: 'DRAFT',
    participantType: mode.teamSize > 1 ? 'TEAM' : 'SOLO',
    maxParticipants: mode.matchType === 'BATTLE_ROYALE' ? 48 : 16,
    registrationOpensAt: null,
    registrationClosesAt: null,
    startsAt: null,
    bannerUrl: null,
    featured: false,
    free: true,
    description: '',
    rules: '',
    prize: '',
    streamUrls: [],
    manualApproval: false,
    waitlistEnabled: true,
    checkIn: { enabled: true, opensMinutesBefore: 30, closesMinutesBefore: 10, requireAllMembers: false },
    rosterLockAt: null,
    stages: [],
    draftStep: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function visibleTemplate(id: string, user: DbUser): DbTemplate {
  const template = db().templates.find((x) => x.id === id);
  if (!template || (template.ownerId !== null && template.ownerId !== user.id && !isAdmin(user))) throw notFound('Modelo');
  return template;
}

const ORGANIZER_ROLES = ['ORGANIZER', 'ADMIN', 'SUPER_ADMIN'] as const;

export const handlers = [
  /** Campeonatos em que sou responsável ou co-organizador (o Admin vê os próprios aqui; a visão global é do painel Admin). */
  http.get(
    url('/organizer/tournaments'),
    handle(() => {
      const user = requireRole(...ORGANIZER_ROLES);
      const d = db();
      const list = d.tournaments
        .map((t): { t: DbTournament; access: TournamentAccess } | null => {
          if (t.ownerId === user.id) return { t, access: 'OWNER' };
          const staff = d.staff.find((s) => s.tournamentId === t.id && s.userId === user.id && s.role === 'CO_ORGANIZER');
          return staff ? { t, access: 'CO_ORGANIZER' } : null;
        })
        .filter((x) => x !== null)
        .sort((a, b) => b.t.updatedAt.localeCompare(a.t.updatedAt))
        .map(({ t, access }) => toOrganizerTournament(t, access));
      return json(list);
    }),
  ),

  /** Detalhe para quem organiza. 403 para quem não é da organização (mesmo que o campeonato seja público). */
  http.get(
    url('/organizer/tournaments/:id'),
    handle(({ params }) => {
      const t = findTournament(param(params, 'id'));
      const { access } = requireTournamentAccess(t, { allowModerator: true });
      return json(toOrganizerDetail(t, access));
    }),
  ),

  // ── Modelos de campeonato ──
  http.get(
    url('/tournament-templates'),
    handle(() => {
      const user = requireRole(...ORGANIZER_ROLES);
      const list = db()
        .templates.filter((t) => t.ownerId === null || t.ownerId === user.id)
        .sort((a, b) => Number(a.ownerId !== null) - Number(b.ownerId !== null) || a.name.localeCompare(b.name, 'pt-BR'))
        .map(toTemplate);
      return json(list);
    }),
  ),

  http.post(
    url('/tournament-templates'),
    handle(async ({ request }) => {
      const user = requireRole(...ORGANIZER_ROLES);
      const input = await body(request, SaveTemplateInput);
      const t = findTournament(input.tournamentId);
      requireTournamentAccess(t);
      if (t.stages.length === 0) throw conflict('Este campeonato ainda não tem fases. Monte as fases antes de salvar como modelo.', 'TEMPLATE_WITHOUT_STAGES');
      const d = db();
      if (d.templates.some((x) => x.ownerId === user.id && x.name.toLowerCase() === input.name.toLowerCase())) {
        throw new HttpProblem(409, 'Você já tem um modelo com este nome.', 'TEMPLATE_NAME_TAKEN', { name: 'Você já tem um modelo com este nome.' });
      }
      const template: DbTemplate = {
        id: uid('tpl'),
        ownerId: user.id,
        name: input.name,
        description: input.description,
        gameId: t.gameId,
        gameModeId: t.gameModeId,
        // Modelo guarda a estrutura, não a identidade: sem nome, datas, banner nem links.
        payload: {
          gameId: t.gameId,
          gameModeId: t.gameModeId,
          maxParticipants: t.maxParticipants,
          manualApproval: t.manualApproval,
          waitlistEnabled: t.waitlistEnabled,
          checkIn: t.checkIn,
          description: t.description,
          rules: t.rules,
          prize: t.prize,
          stages: [...t.stages].sort((a, b) => a.order - b.order).map((s) => ({ ...toStageInput(s), id: undefined })),
        },
      };
      d.templates.push(template);
      save();
      return json(toTemplate(template), 201);
    }),
  ),

  http.delete(
    url('/tournament-templates/:id'),
    handle(({ params }) => {
      const user = requireRole(...ORGANIZER_ROLES);
      const d = db();
      const template = visibleTemplate(param(params, 'id'), user);
      if (template.ownerId !== user.id) throw forbidden(template.ownerId === null ? 'Os modelos da plataforma não podem ser excluídos.' : 'Você só pode excluir os seus modelos.');
      d.templates = d.templates.filter((x) => x.id !== template.id);
      save();
      return noContent();
    }),
  ),

  // ── Modelo de pontuação personalizado (opção "personalizar" da fase) ──
  http.post(
    url('/organizer/scoring-models'),
    handle(async ({ request }) => {
      const user = requireRole(...ORGANIZER_ROLES);
      const input = await body(request, CustomScoringModelInput);
      const game = db().games.find((g) => g.id === input.gameId);
      if (!game) throw notFound('Jogo');
      const errors = validateScoringModel({ id: 'novo', name: input.name, gameSlug: game.slug, matchType: input.matchType, rules: input.rules, tiebreakers: input.tiebreakers });
      if (errors.length > 0) throw badRequest(errors.join(' '), 'INVALID_SCORING_MODEL');
      const model: ScoringModel = { id: uid('sm'), gameId: game.id, name: input.name, matchType: input.matchType, rules: input.rules, tiebreakers: input.tiebreakers, isDefault: false, ownerId: user.id };
      game.scoringModels.push(model);
      save();
      return json(model, 201);
    }),
  ),

  http.put(
    url('/organizer/scoring-models/:id'),
    handle(async ({ request, params }) => {
      const user = requireRole(...ORGANIZER_ROLES);
      const id = param(params, 'id');
      const input = await body(request, CustomScoringModelInput);
      const d = db();
      const game = d.games.find((g) => g.scoringModels.some((m) => m.id === id));
      const model = game?.scoringModels.find((m) => m.id === id);
      if (!game || !model) throw notFound('Modelo de pontuação');
      if (model.ownerId !== user.id) throw forbidden('Você só pode alterar os modelos de pontuação que criou.');
      // RN-02: mudar a pontuação de uma fase que já começou é outro fluxo (com recálculo e auditoria).
      const inUse = d.tournaments.some((t) => t.stages.some((s) => s.scoringModelId === id && s.status !== 'PENDING'));
      if (inUse) throw conflict('Este modelo é usado por uma fase que já começou e não pode ser alterado aqui.', 'SCORING_MODEL_IN_USE');
      const errors = validateScoringModel({ id, name: input.name, gameSlug: game.slug, matchType: input.matchType, rules: input.rules, tiebreakers: input.tiebreakers });
      if (errors.length > 0) throw badRequest(errors.join(' '), 'INVALID_SCORING_MODEL');
      model.name = input.name;
      model.matchType = input.matchType;
      model.rules = input.rules;
      model.tiebreakers = input.tiebreakers;
      save();
      return json(model);
    }),
  ),

  // ── Rascunho ──
  http.post(
    url('/tournaments'),
    handle(async ({ request }) => {
      const user = requireRole(...ORGANIZER_ROLES);
      const { templateId, ...input } = await body(request, CreateTournamentInput);
      const template = templateId ? visibleTemplate(templateId, user) : null;
      // O que veio no corpo vale mais que o modelo.
      const merged: TournamentDraftInput = { ...(template?.payload ?? {}), ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };

      const fallback = merged.gameId ? null : defaultGameFor(user);
      const gameId = merged.gameId ?? fallback?.game.id ?? '';
      const gameModeId = merged.gameModeId ?? db().games.find((g) => g.id === gameId)?.modes[0]?.id ?? '';
      const t = newTournament(user, merged.name?.trim() || UNNAMED, gameId, gameModeId);
      applyDraft(t, { ...merged, gameId: undefined, gameModeId: undefined, name: undefined });
      db().tournaments.push(t);
      save();
      return json(toOrganizerDetail(t, isAdmin(user) ? 'ADMIN' : 'OWNER'), 201);
    }),
  ),

  http.patch(
    url('/tournaments/:id'),
    handle(async ({ request, params }) => {
      const t = findTournament(param(params, 'id'));
      const { access } = requireTournamentAccess(t);
      const input = await body(request, TournamentDraftInput);
      if (READ_ONLY.includes(t.status)) throw conflict('Este campeonato já foi encerrado e não pode mais ser editado.', 'TOURNAMENT_READ_ONLY');

      if (t.status === 'DRAFT') {
        applyDraft(t, input);
        save();
        return json(toOrganizerDetail(t, access));
      }

      // Publicado: o jogo não muda mais, as inscrições só mudam antes de começar e o resultado precisa continuar válido.
      if ((input.gameId !== undefined && input.gameId !== t.gameId) || (input.gameModeId !== undefined && input.gameModeId !== t.gameModeId)) {
        throw conflict('O jogo e o modo não podem mudar depois que o campeonato é publicado.', 'GAME_LOCKED');
      }
      if (STARTED.includes(t.status)) {
        const changed =
          (input.maxParticipants !== undefined && input.maxParticipants !== t.maxParticipants) ||
          (input.registrationOpensAt !== undefined && input.registrationOpensAt !== t.registrationOpensAt) ||
          (input.registrationClosesAt !== undefined && input.registrationClosesAt !== t.registrationClosesAt) ||
          (input.startsAt !== undefined && input.startsAt !== t.startsAt);
        if (changed) throw conflict('Vagas e datas não podem mudar com o campeonato em andamento.', 'REGISTRATION_LOCKED');
      }
      const next: DbTournament = structuredClone(t);
      applyDraft(next, input);
      // Só barra o que esta edição toca: uma pendência antiga em outro campo (ex.: o jogo saiu do catálogo)
      // não pode impedir a organização de corrigir o regulamento ou a premiação.
      const touched = new Set(Object.entries(input).filter(([, value]) => value !== undefined).map(([key]) => key));
      const dates = ['registrationOpensAt', 'registrationClosesAt', 'startsAt', 'rosterLockAt'];
      const issues = validateDraft(toDraft(next), { games: db().games, now: new Date(), alreadyPublished: true, takenSlots: takenSlots(t.id) }).filter((issue) => {
        const root = issue.field.split('.')[0] ?? '';
        if (touched.has(root)) return true;
        if (root === 'stages') return touched.has('maxParticipants');
        return dates.includes(root) && dates.some((field) => touched.has(field));
      });
      if (issues.length > 0) throw badRequest(issues[0]?.message ?? 'Confira os campos destacados.', 'VALIDATION', issuesToErrors(issues));
      if (input.stages !== undefined) refreshStalePreviews(t.stages, next.stages);
      Object.assign(t, next);
      save();
      return json(toOrganizerDetail(t, access));
    }),
  ),

  http.delete(
    url('/tournaments/:id'),
    handle(({ params }) => {
      const t = findTournament(param(params, 'id'));
      requireOwner(t, 'excluir o rascunho');
      if (t.status !== 'DRAFT') throw conflict('Só rascunhos podem ser excluídos. Um campeonato publicado precisa ser cancelado.', 'NOT_A_DRAFT');
      const d = db();
      d.tournaments = d.tournaments.filter((x) => x.id !== t.id);
      d.staff = d.staff.filter((s) => s.tournamentId !== t.id);
      save();
      return noContent();
    }),
  ),

  // ── Ciclo de vida (PRD §8.3) ──
  http.post(
    url('/tournaments/:id/publish'),
    handle(({ params }) => {
      const t = findTournament(param(params, 'id'));
      const { access } = requireOwner(t, 'publicar');
      if (!canTransition(t.status, 'PUBLISHED')) throw conflict('Este campeonato já foi publicado.', 'INVALID_TRANSITION');

      const d = db();
      const now = new Date();
      const issues = validateDraft(toDraft(t), { games: d.games, now });
      if (issues.length > 0) {
        const n = issues.length;
        throw badRequest(`Ainda ${n === 1 ? 'falta 1 ponto' : `faltam ${n} pontos`} para publicar. Confira a revisão.`, 'INCOMPLETE', issuesToErrors(issues));
      }

      // RN-10: o limite é do responsável pelo campeonato e só é conferido ao publicar.
      const owner = d.users.find((u) => u.id === t.ownerId);
      if (!owner) throw notFound('Organizador');
      const check = checkOrganizerLimits(limitsOf(owner), {
        activeCount: countActiveTournaments(d.tournaments.filter((x) => x.id !== t.id), owner.id),
        gameId: t.gameId,
        gameName: d.games.find((g) => g.id === t.gameId)?.name,
      });
      if (!check.ok) throw new HttpProblem(check.code === 'GAME_NOT_ALLOWED' ? 403 : 409, check.message, check.code);

      // Sem data de abertura (ou com data já passada), as inscrições abrem na hora.
      const opensNow = t.registrationOpensAt === null || new Date(t.registrationOpensAt).getTime() <= now.getTime();
      t.status = opensNow ? 'REGISTRATION_OPEN' : 'PUBLISHED';
      if (opensNow && t.registrationOpensAt === null) t.registrationOpensAt = now.toISOString();
      t.draftStep = 6;
      t.updatedAt = now.toISOString();
      save();
      return json(toOrganizerDetail(t, access));
    }),
  ),

  http.post(
    url('/tournaments/:id/open-registration'),
    handle(({ params }) => {
      const t = findTournament(param(params, 'id'));
      const { access } = requireTournamentAccess(t);
      if (!canTransition(t.status, 'REGISTRATION_OPEN')) throw conflict('As inscrições só podem ser abertas em um campeonato publicado que ainda não abriu.', 'INVALID_TRANSITION');
      const now = new Date();
      if (t.registrationClosesAt !== null && new Date(t.registrationClosesAt).getTime() <= now.getTime()) {
        throw conflict('O prazo de inscrição já passou. Ajuste a data de fechamento antes de abrir.', 'REGISTRATION_DEADLINE_PASSED');
      }
      t.status = 'REGISTRATION_OPEN';
      t.registrationOpensAt = now.toISOString();
      t.updatedAt = now.toISOString();
      save();
      return json(toOrganizerDetail(t, access));
    }),
  ),

  http.post(
    url('/tournaments/:id/close-registration'),
    handle(({ params }) => {
      const t = findTournament(param(params, 'id'));
      const { access } = requireTournamentAccess(t);
      if (!canTransition(t.status, 'REGISTRATION_CLOSED')) throw conflict('As inscrições só podem ser encerradas enquanto estão abertas.', 'INVALID_TRANSITION');
      const now = new Date();
      t.status = 'REGISTRATION_CLOSED';
      if (t.registrationClosesAt === null || new Date(t.registrationClosesAt).getTime() > now.getTime()) t.registrationClosesAt = now.toISOString();
      t.updatedAt = now.toISOString();
      save();
      return json(toOrganizerDetail(t, access));
    }),
  ),

  http.post(
    url('/tournaments/:id/cancel'),
    handle(async ({ request, params }) => {
      const t = findTournament(param(params, 'id'));
      const { user, access } = requireOwner(t, 'cancelar');
      const { reason } = await body(request, CancelTournamentInput);
      if (!canTransition(t.status, 'CANCELLED')) {
        throw conflict(t.status === 'CANCELLED' ? 'Este campeonato já está cancelado.' : 'Este campeonato não pode ser cancelado no estado atual. Em andamento, pause antes de cancelar.', 'INVALID_TRANSITION');
      }
      const wasPublic = ACTIVE_TOURNAMENT_STATUSES.includes(t.status);
      const now = nowIso();
      t.status = 'CANCELLED';
      t.updatedAt = now;
      cancellations().push({ tournamentId: t.id, reason, byUserId: user.id, at: now });
      if (wasPublic) {
        // Quem acompanha a página pública fica sabendo o motivo.
        const notice: Announcement = { id: uid('an'), tournamentId: t.id, stageId: null, groupId: null, authorNickname: user.nickname, title: 'Campeonato cancelado', body: reason, createdAt: now };
        db().announcements.push(notice);
      }
      save();
      audit(user, { action: 'TOURNAMENT_STATUS_CHANGED', entityType: 'Tournament', entityId: t.id, entityLabel: t.name, tournamentId: t.id, after: { status: 'CANCELLED' }, reason });
      return json(toOrganizerDetail(t, access));
    }),
  ),

  http.post(
    url('/tournaments/:id/duplicate'),
    handle(({ params }) => {
      const user = requireRole(...ORGANIZER_ROLES);
      const source = findTournament(param(params, 'id'));
      requireTournamentAccess(source);
      const now = Date.now();
      const future = (iso: string | null) => (iso !== null && new Date(iso).getTime() > now ? iso : null);
      const base = source.name === UNNAMED ? UNNAMED : `Cópia de ${source.name}`.slice(0, 80);
      const t = newTournament(user, base, source.gameId, source.gameModeId);
      Object.assign(t, {
        maxParticipants: source.maxParticipants,
        description: source.description,
        rules: source.rules,
        prize: source.prize,
        bannerUrl: source.bannerUrl,
        streamUrls: [...source.streamUrls],
        manualApproval: source.manualApproval,
        waitlistEnabled: source.waitlistEnabled,
        checkIn: { ...source.checkIn },
        // Datas que já passaram não servem para a cópia.
        registrationOpensAt: future(source.registrationOpensAt),
        registrationClosesAt: future(source.registrationClosesAt),
        startsAt: future(source.startsAt),
        rosterLockAt: future(source.rosterLockAt),
      } satisfies Partial<DbTournament>);
      t.stages = buildStages(t, [...source.stages].sort((a, b) => a.order - b.order).map((s) => ({ ...toStageInput(s), id: undefined })));
      db().tournaments.push(t);
      save();
      return json(toOrganizerDetail(t, tournamentAccess(requireUser(), t) ?? 'OWNER'), 201);
    }),
  ),
];
