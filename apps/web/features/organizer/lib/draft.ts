/**
 * Estado do assistente de criação: valores padrão ("criar e publicar em até 10 minutos"),
 * conversão de/para o contrato da API e o corpo do rascunho automático.
 */
import { isAllowedStreamUrl, TournamentDraftInput, type CheckInConfig, type Game, type GameMode, type StageInput, type Tournament, type TournamentTemplate } from '@nova/schemas';
import type { DraftForValidation } from '../validation';
import { defaultMaxParticipants, FORMAT_INFO, formatAvailability, stageMatchType } from './formats';

/** Fase dentro do assistente: o contrato da API mais uma chave local estável (para arrastar, abrir e fechar). */
export type StageDraft = StageInput & { key: string };

let stageKeyCounter = 0;
export function newStageKey(): string {
  stageKeyCounter += 1;
  return `fase-${Date.now().toString(36)}-${stageKeyCounter}`;
}
export function withStageKeys(stages: StageInput[]): StageDraft[] {
  return stages.map((s) => ({ ...s, key: newStageKey() }));
}

export interface WizardValues {
  name: string;
  description: string;
  rules: string;
  prize: string;
  bannerUrl: string | null;
  streamUrls: string[];
  gameId: string;
  gameModeId: string;
  maxParticipants: number;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  startsAt: string | null;
  manualApproval: boolean;
  waitlistEnabled: boolean;
  checkIn: CheckInConfig;
  rosterLockAt: string | null;
  stages: StageDraft[];
}

/** Nome que a API dá ao rascunho criado sem nome. Para o assistente, é o mesmo que "ainda sem nome". */
export const UNNAMED_TOURNAMENT = 'Campeonato sem nome';

export const DEFAULT_CHECK_IN: CheckInConfig = { enabled: true, opensMinutesBefore: 30, closesMinutesBefore: 10, requireAllMembers: false };

/** Regulamento inicial: o organizador ajusta em vez de começar da página em branco. */
export const DEFAULT_RULES_HTML =
  '<h3>Regras gerais</h3><ul><li>Respeite os horários: quem não fizer check-in leva W.O.</li><li>É proibido usar hacks, emuladores ou qualquer vantagem indevida.</li><li>Todo resultado precisa do print da tela final.</li><li>As decisões da organização são finais.</li></ul>';

const HOUR = 3600_000;

/** Datas padrão: começa em 7 dias, às 20h do fuso de quem está criando; inscrições fecham na véspera. */
export function defaultDates(now: Date): Pick<WizardValues, 'registrationOpensAt' | 'registrationClosesAt' | 'startsAt'> {
  const start = new Date(now);
  start.setDate(start.getDate() + 7);
  start.setHours(20, 0, 0, 0);
  return { registrationOpensAt: null, registrationClosesAt: new Date(start.getTime() - 24 * HOUR).toISOString(), startsAt: start.toISOString() };
}

/** Jogos em que este organizador pode criar campeonato (ativos e liberados para a conta). */
export function selectableGames(games: Game[], allowedGameIds: string[] | null): Game[] {
  return games.filter((g) => g.active && g.modes.length > 0 && (!allowedGameIds || allowedGameIds.length === 0 || allowedGameIds.includes(g.id)));
}

export function findMode(games: Game[], gameId: string, gameModeId: string): { game: Game | null; mode: GameMode | null } {
  const game = games.find((g) => g.id === gameId) ?? null;
  return { game, mode: game?.modes.find((m) => m.id === gameModeId) ?? null };
}

/** Assistente em branco, com padrões sensatos em tudo. */
export function defaultWizardValues(now: Date, games: Game[]): WizardValues {
  const game = games[0] ?? null;
  const mode = game?.modes[0] ?? null;
  return {
    name: '',
    description: '',
    rules: DEFAULT_RULES_HTML,
    prize: '',
    bannerUrl: null,
    streamUrls: [],
    gameId: game?.id ?? '',
    gameModeId: mode?.id ?? '',
    maxParticipants: defaultMaxParticipants(mode),
    ...defaultDates(now),
    manualApproval: false,
    waitlistEnabled: true,
    checkIn: DEFAULT_CHECK_IN,
    rosterLockAt: null,
    stages: [],
  };
}

/** Rascunho (ou campeonato) vindo da API → valores do assistente. */
export function tournamentToValues(t: Tournament): WizardValues {
  return {
    name: t.name === UNNAMED_TOURNAMENT ? '' : t.name,
    description: t.description,
    rules: t.rules,
    prize: t.prize,
    bannerUrl: t.bannerUrl,
    streamUrls: t.streamUrls,
    gameId: t.gameId,
    gameModeId: t.gameModeId,
    maxParticipants: t.maxParticipants,
    registrationOpensAt: t.registrationOpensAt,
    registrationClosesAt: t.registrationClosesAt,
    startsAt: t.startsAt,
    manualApproval: t.manualApproval,
    waitlistEnabled: t.waitlistEnabled,
    checkIn: t.checkIn,
    rosterLockAt: t.rosterLockAt,
    stages: [...t.stages]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({ key: newStageKey(), id: s.id, name: s.name, format: s.format, scoringModelId: s.scoringModelId, config: s.config, qualification: s.qualification, tiebreakers: s.tiebreakers, seeding: s.seeding })),
  };
}

/** Começar a partir de um modelo: o modelo preenche o que tem; o resto fica com os padrões. */
export function templateToValues(template: Pick<TournamentTemplate, 'gameId' | 'gameModeId' | 'payload'>, base: WizardValues): WizardValues {
  const p = template.payload;
  return {
    ...base,
    name: p.name ?? base.name,
    description: p.description ?? base.description,
    rules: p.rules ?? base.rules,
    prize: p.prize ?? base.prize,
    bannerUrl: p.bannerUrl ?? base.bannerUrl,
    streamUrls: p.streamUrls ?? base.streamUrls,
    gameId: p.gameId ?? template.gameId,
    gameModeId: p.gameModeId ?? template.gameModeId,
    maxParticipants: p.maxParticipants ?? base.maxParticipants,
    manualApproval: p.manualApproval ?? base.manualApproval,
    waitlistEnabled: p.waitlistEnabled ?? base.waitlistEnabled,
    checkIn: p.checkIn ?? base.checkIn,
    // Modelo não carrega datas nem identidade das fases: o campeonato novo começa do zero nisso.
    stages: (p.stages ?? []).map((s) => ({ key: newStageKey(), name: s.name, format: s.format, scoringModelId: s.scoringModelId, config: s.config, qualification: s.qualification, tiebreakers: s.tiebreakers, seeding: s.seeding })),
  };
}

export function isValidName(name: string): boolean {
  const n = name.trim();
  return n.length >= 3 && n.length <= 80;
}

/**
 * Corpo do rascunho automático. O rascunho aceita tudo pela metade, mas o contrato não aceita
 * valor inválido: o que ainda não está válido (nome curto, link quebrado, vagas fora da faixa)
 * simplesmente não vai nesta gravação.
 */
export function toDraftPayload(values: WizardValues, draftStep: number): TournamentDraftInput {
  const payload: TournamentDraftInput = {
    description: values.description,
    rules: values.rules,
    prize: values.prize.slice(0, 2000),
    bannerUrl: values.bannerUrl,
    streamUrls: values.streamUrls.map((u) => u.trim()).filter(isAllowedStreamUrl).slice(0, 4),
    registrationOpensAt: values.registrationOpensAt,
    registrationClosesAt: values.registrationClosesAt,
    startsAt: values.startsAt,
    manualApproval: values.manualApproval,
    waitlistEnabled: values.waitlistEnabled,
    rosterLockAt: values.rosterLockAt,
    draftStep: Math.min(6, Math.max(0, Math.trunc(draftStep))),
  };
  if (isValidName(values.name)) payload.name = values.name.trim();
  if (values.gameId) payload.gameId = values.gameId;
  if (values.gameModeId) payload.gameModeId = values.gameModeId;
  if (Number.isInteger(values.maxParticipants) && values.maxParticipants >= 2 && values.maxParticipants <= 1024) payload.maxParticipants = values.maxParticipants;

  const withCheckIn = { ...payload, checkIn: values.checkIn };
  const withStages = { ...withCheckIn, stages: values.stages.map((s, i) => ({ ...s, name: s.name.trim() || `Fase ${i + 1}` })) };
  // Rede de segurança: se algum pedaço ainda não passa no contrato, grava o resto.
  for (const candidate of [withStages, withCheckIn, payload]) {
    const parsed = TournamentDraftInput.safeParse(candidate);
    if (parsed.success) return parsed.data;
  }
  return { draftStep: payload.draftStep };
}

export function valuesForValidation(values: WizardValues): DraftForValidation {
  return {
    name: values.name,
    description: values.description,
    rules: values.rules,
    prize: values.prize,
    streamUrls: values.streamUrls,
    gameId: values.gameId,
    gameModeId: values.gameModeId,
    maxParticipants: values.maxParticipants,
    registrationOpensAt: values.registrationOpensAt,
    registrationClosesAt: values.registrationClosesAt,
    startsAt: values.startsAt,
    rosterLockAt: values.rosterLockAt,
    checkIn: values.checkIn,
    stages: values.stages,
  };
}

/** As fases ainda servem para este jogo e modo? (formato disponível e modelo de pontuação do jogo, do tipo certo) */
export function stagesFitMode(stages: StageInput[], game: Game, mode: GameMode): boolean {
  return stages.every((s) => {
    if (!formatAvailability(s.format, game, mode).available) return false;
    const model = game.scoringModels.find((m) => m.id === s.scoringModelId);
    return model !== undefined && model.matchType === stageMatchType(s.format, s.config, mode);
  });
}

/** "Mata-mata 4v4 · Equipe x Equipe" */
export function stageTitle(stage: Pick<StageInput, 'name' | 'format'>, index: number): string {
  return `${stage.name.trim() || `Fase ${index + 1}`} · ${FORMAT_INFO[stage.format].name}`;
}
