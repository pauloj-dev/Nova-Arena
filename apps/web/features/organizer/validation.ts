/**
 * Validação do campeonato (pura, sem React nem DOM): é a mesma função na tela do assistente
 * e no `POST /tournaments/:id/publish` da API simulada.
 *
 * - `computeStageFlow`: quantos participantes cada fase recebe e quantos classifica.
 * - `validateStages`: validação entre fases, com a mensagem ligada à fase e ao campo certos.
 * - `validateDraft`: pendências do campeonato inteiro, ligadas ao passo do assistente.
 */
import { isAllowedStreamUrl, type CheckInConfig, type Game, type GameMode, type Qualification, type StageInput } from '@nova/schemas';
import { FORMAT_INFO, formatAvailability, groupModeAvailability, isBattleRoyaleStage, isElimination, stageMatchType } from './lib/formats';
import { MATCH_TYPE_LABEL } from './lib/labels';

export type StageIssueField = 'name' | 'format' | 'config' | 'scoring' | 'tiebreakers' | 'qualification';

export interface StageIssue {
  /** Índice da fase (base 0). */
  stageIndex: number;
  field: StageIssueField;
  message: string;
}

export interface StageFlow {
  /** Quantos participantes a fase recebe. Nulo quando a fase anterior não fecha a conta. */
  entrants: number | null;
  /** Grupos (GROUPS) ou salas (BATTLE_ROYALE). Nulo nos outros formatos. */
  pools: number | null;
  /** Maior grupo ou sala. */
  poolSize: number | null;
  /** Quantos avançam para a próxima fase (já com a repescagem). Nulo na última fase. */
  qualified: number | null;
}

export interface StageValidationContext {
  maxParticipants: number;
  game?: Pick<Game, 'name' | 'modes' | 'scoringModels'> | null;
  mode?: Pick<GameMode, 'name' | 'teamSize' | 'matchType' | 'maxLobbySize'> | null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const participants = (n: number) => plural(n, 'participante', 'participantes');
const isPowerOfTwo = (n: number) => n >= 1 && (n & (n - 1)) === 0;

/** Máximo de rodadas do suíço sem repetir confronto (mesma conta do motor). */
export function maxSwissRounds(entrants: number): number {
  return entrants % 2 === 0 ? entrants - 1 : entrants;
}

/** Em quantos grupos ou salas a fase divide os participantes. A final BR (última fase) é sempre uma sala só. */
function poolsOf(stage: StageInput, entrants: number, isLast: boolean): number | null {
  if (stage.format === 'GROUPS') return stage.config.groupCount;
  if (stage.format === 'BATTLE_ROYALE') return isLast ? 1 : Math.max(1, Math.ceil(entrants / stage.config.lobbySize));
  return null;
}

/** Quantos avançam pela regra, sem a repescagem. Nulo quando a regra não se aplica ao formato. */
function directQualified(stage: StageInput, q: Qualification, pools: number | null): number | null {
  switch (q.type) {
    case 'TOP_N_PER_GROUP':
      return pools === null ? null : q.n * pools;
    case 'TOP_N_OVERALL':
      return q.n;
    case 'WINNERS':
      if (isElimination(stage.format)) return q.n;
      return pools;
  }
}

/** Fluxo de participantes fase a fase, a partir das vagas do campeonato. */
export function computeStageFlow(stages: StageInput[], maxParticipants: number): StageFlow[] {
  const flow: StageFlow[] = [];
  let entrants: number | null = Number.isInteger(maxParticipants) && maxParticipants > 0 ? maxParticipants : null;
  stages.forEach((stage, index) => {
    const isLast = index === stages.length - 1;
    const pools = entrants === null ? null : poolsOf(stage, entrants, isLast);
    const poolSize = entrants === null || pools === null || pools < 1 ? null : Math.ceil(entrants / pools);
    let qualified: number | null = null;
    if (!isLast && stage.qualification && entrants !== null) {
      const direct = directQualified(stage, stage.qualification, pools);
      qualified = direct === null ? null : direct + stage.qualification.repechage;
    }
    flow.push({ entrants, pools, poolSize, qualified });
    entrants = isLast ? null : qualified !== null && qualified <= (entrants ?? 0) ? qualified : null;
  });
  return flow;
}

/** Validação entre fases. Lista vazia = configuração válida. */
export function validateStages(stages: StageInput[], ctx: StageValidationContext): StageIssue[] {
  const issues: StageIssue[] = [];
  const flow = computeStageFlow(stages, ctx.maxParticipants);
  const { game, mode } = ctx;

  stages.forEach((stage, stageIndex) => {
    const add = (field: StageIssueField, message: string) => issues.push({ stageIndex, field, message });
    const isFirst = stageIndex === 0;
    const isLast = stageIndex === stages.length - 1;
    const info = FORMAT_INFO[stage.format];
    const step = flow[stageIndex];
    const entrants = step?.entrants ?? null;
    const source = isFirst ? `as ${ctx.maxParticipants} vagas do campeonato` : `os ${entrants ?? 0} classificados da fase anterior`;
    const cfg = stage.config;

    if (stage.name.trim() === '') add('name', 'Dê um nome à fase.');

    // ── Formato x modo do jogo ──
    if (game && mode) {
      const availability = formatAvailability(stage.format, game, mode);
      if (!availability.available && availability.reason) add('format', availability.reason);
      else if (stage.format === 'GROUPS') {
        const groupMode = groupModeAvailability(cfg.groupMode, game, mode);
        if (!groupMode.available && groupMode.reason) add('config', groupMode.reason);
      }
    }

    // ── Configuração x número de participantes ──
    const usesLobby = isBattleRoyaleStage(stage.format, cfg);
    if (usesLobby && mode?.maxLobbySize && cfg.lobbySize > mode.maxLobbySize) {
      add('config', `A sala de ${mode.name} comporta no máximo ${mode.maxLobbySize} equipes. Diminua o tamanho da sala (hoje ${cfg.lobbySize}).`);
    }
    if (entrants !== null) {
      if (entrants < 2) {
        add('config', `${info.name} precisa de pelo menos 2 participantes, mas esta fase recebe ${entrants}.`);
      } else if (stage.format === 'GROUPS') {
        if (cfg.groupCount > entrants) {
          add('config', `Há mais grupos (${cfg.groupCount}) do que participantes (${entrants}). Use no máximo ${Math.floor(entrants / 2)} ${Math.floor(entrants / 2) === 1 ? 'grupo' : 'grupos'}.`);
        } else if (Math.floor(entrants / cfg.groupCount) < 2) {
          add('config', `Com ${participants(entrants)} em ${cfg.groupCount} grupos, algum grupo ficaria com menos de 2. Use no máximo ${Math.floor(entrants / 2)} ${Math.floor(entrants / 2) === 1 ? 'grupo' : 'grupos'}.`);
        } else if (cfg.groupMode === 'BATTLE_ROYALE' && Math.ceil(entrants / cfg.groupCount) > cfg.lobbySize) {
          const needed = Math.ceil(entrants / cfg.lobbySize);
          add(
            'config',
            `Com ${source} em ${cfg.groupCount} ${cfg.groupCount === 1 ? 'grupo' : 'grupos'}, cada grupo teria até ${Math.ceil(entrants / cfg.groupCount)} equipes, mas a sala comporta ${cfg.lobbySize}. Use pelo menos ${needed} grupos ou aumente o tamanho da sala.`,
          );
        }
      } else if (stage.format === 'BATTLE_ROYALE') {
        const lobbies = step?.pools ?? 1;
        if (entrants > cfg.lobbySize * lobbies) {
          add(
            'config',
            isLast
              ? `A final é jogada em uma sala só: ela recebe ${entrants} equipes, mas a sala comporta ${cfg.lobbySize}. ${isFirst ? 'Diminua as vagas, aumente o tamanho da sala ou comece por uma fase de grupos.' : 'Classifique menos equipes na fase anterior ou aumente o tamanho da sala.'}`
              : `Esta fase recebe ${entrants} equipes, mais do que cabem em ${plural(lobbies, 'sala', 'salas')} de ${cfg.lobbySize}.`,
          );
        }
      } else if (stage.format === 'SWISS' && cfg.rounds > maxSwissRounds(entrants)) {
        add('config', `Com ${participants(entrants)}, o suíço comporta no máximo ${plural(maxSwissRounds(entrants), 'rodada', 'rodadas')} sem repetir confronto (hoje ${cfg.rounds}).`);
      }
    }

    // ── Pontuação ──
    if (!stage.scoringModelId) {
      add('scoring', 'Escolha o modelo de pontuação desta fase.');
    } else if (game && mode) {
      const model = game.scoringModels.find((m) => m.id === stage.scoringModelId);
      const expected = stageMatchType(stage.format, cfg, mode);
      if (!model) add('scoring', `O modelo de pontuação desta fase não existe em ${game.name}. Escolha outro.`);
      else if (model.matchType !== expected) {
        add('scoring', `O modelo "${model.name}" é de ${MATCH_TYPE_LABEL[model.matchType]}, mas esta fase é de ${MATCH_TYPE_LABEL[expected]}. Escolha um modelo compatível.`);
      }
    }

    // ── Desempate ──
    if (stage.tiebreakers.length === 0) add('tiebreakers', 'Escolha pelo menos um critério de desempate.');
    else if (new Set(stage.tiebreakers).size !== stage.tiebreakers.length) add('tiebreakers', 'Há um critério de desempate repetido.');

    // ── Classificação para a próxima fase ──
    const q = stage.qualification;
    if (isLast) {
      if (q !== null) add('qualification', 'A última fase não classifica para outra fase. Remova a regra de classificação.');
      return;
    }
    if (q === null) {
      add('qualification', 'Defina quem avança para a próxima fase.');
      return;
    }
    const pools = step?.pools ?? null;
    if (q.type === 'TOP_N_PER_GROUP' && stage.format !== 'GROUPS' && stage.format !== 'BATTLE_ROYALE') {
      add('qualification', `"Top N por grupo" só vale para fase de grupos. Em ${info.name}, use ${isElimination(stage.format) ? '"Vencedores"' : '"Top N geral"'}.`);
      return;
    }
    if (q.type === 'WINNERS' && (stage.format === 'ROUND_ROBIN' || stage.format === 'SWISS')) {
      add('qualification', `"Vencedores" só vale para mata-mata. Em ${info.name}, use "Top N geral".`);
      return;
    }
    if (entrants === null || entrants < 2) return;

    const direct = directQualified(stage, q, pools);
    if (direct === null) return;
    if (q.type === 'TOP_N_PER_GROUP' && pools !== null) {
      const smallest = Math.floor(entrants / pools);
      const unit = stage.format === 'GROUPS' ? 'grupo' : 'sala';
      if (q.n > smallest) {
        add('qualification', `Top ${q.n} por ${unit} não fecha: com ${participants(entrants)} em ${plural(pools, unit, `${unit}s`)}, há ${unit} com só ${smallest}.`);
        return;
      }
    }
    if (q.type === 'TOP_N_OVERALL' && q.n > entrants) {
      add('qualification', `Top ${q.n} não fecha: esta fase só tem ${participants(entrants)}.`);
      return;
    }
    if (q.type === 'WINNERS' && isElimination(stage.format)) {
      if (!isPowerOfTwo(q.n)) {
        add('qualification', `No mata-mata, o número de vencedores que avançam precisa ser 1, 2, 4, 8… (hoje ${q.n}).`);
        return;
      }
      if (q.n >= entrants) {
        add('qualification', `Não dá para classificar ${plural(q.n, 'vencedor', 'vencedores')} de um mata-mata com ${participants(entrants)}: ninguém seria eliminado.`);
        return;
      }
    }
    const total = direct + q.repechage;
    if (total > entrants) {
      add('qualification', `A repescagem pede mais gente do que sobra: ${direct} classificados + ${q.repechage} de repescagem passam dos ${participants(entrants)} da fase.`);
      return;
    }
    if (total < 2) {
      add('qualification', `Precisam avançar pelo menos 2 participantes para a próxima fase (hoje avança ${total}).`);
    }
  });

  return issues;
}

// ── Campeonato inteiro ───────────────────────────────────────────────

/** Passos do assistente (PRD ORG-01). O índice é o `draftStep` gravado no rascunho. */
export const WIZARD_STEPS = [
  { id: 'info', label: 'Informações' },
  { id: 'game', label: 'Jogo e modo' },
  { id: 'registration', label: 'Inscrições' },
  { id: 'stages', label: 'Fases' },
  { id: 'scoring', label: 'Pontuação' },
  { id: 'rules', label: 'Regras' },
  { id: 'review', label: 'Revisão e publicar' },
] as const;
export const REVIEW_STEP = 6;

export interface DraftForValidation {
  name: string;
  description: string;
  rules: string;
  prize: string;
  streamUrls: string[];
  gameId: string;
  gameModeId: string;
  maxParticipants: number;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  startsAt: string | null;
  rosterLockAt: string | null;
  checkIn: CheckInConfig;
  stages: StageInput[];
}

export interface DraftIssue {
  /** Passo do assistente em que a pendência se resolve (0 a 5). */
  step: number;
  /** Caminho do campo (o mesmo do formulário), ex.: `name`, `startsAt`, `stages.1.qualification`. */
  field: string;
  message: string;
  stageIndex?: number;
}

export interface DraftValidationContext {
  games: Game[];
  now: Date;
  /** Campeonato já publicado: datas no passado deixam de ser erro. */
  alreadyPublished?: boolean;
  /** Vagas já ocupadas (as vagas não podem ficar abaixo disso). */
  takenSlots?: number;
}

/** O HTML tem algum texto de verdade? (`<p></p>` conta como vazio.) */
export function isRichTextEmpty(html: string): boolean {
  return (
    html
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;|&#160;/gi, ' ')
      .trim() === ''
  );
}

const time = (iso: string | null) => (iso ? new Date(iso).getTime() : null);

/** Pendências para publicar. Lista vazia = pode publicar. */
export function validateDraft(draft: DraftForValidation, ctx: DraftValidationContext): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const add = (step: number, field: string, message: string, stageIndex?: number) => issues.push({ step, field, message, ...(stageIndex === undefined ? {} : { stageIndex }) });

  // Passo 0 — Informações
  const name = draft.name.trim();
  if (name.length < 3) add(0, 'name', name === '' ? 'Dê um nome ao campeonato.' : 'O nome precisa de pelo menos 3 caracteres.');
  else if (name.length > 80) add(0, 'name', 'O nome pode ter no máximo 80 caracteres.');
  draft.streamUrls.forEach((url, i) => {
    if (!isAllowedStreamUrl(url)) add(0, `streamUrls.${i}`, 'Só aceitamos links da Twitch e do YouTube (começando com https://).');
  });
  if (draft.streamUrls.length > 4) add(0, 'streamUrls', 'São no máximo 4 links de transmissão.');

  // Passo 1 — Jogo e modo
  const game = ctx.games.find((g) => g.id === draft.gameId) ?? null;
  const mode = game?.modes.find((m) => m.id === draft.gameModeId) ?? null;
  if (!game) add(1, 'gameId', 'Escolha o jogo do campeonato.');
  else if (!game.active) add(1, 'gameId', `${game.name} não está mais disponível para novos campeonatos. Escolha outro jogo.`);
  else if (!mode) add(1, 'gameModeId', `Escolha o modo de ${game.name}.`);

  // Passo 2 — Inscrições
  const max = draft.maxParticipants;
  if (!Number.isInteger(max) || max < 2) add(2, 'maxParticipants', 'O campeonato precisa de pelo menos 2 vagas.');
  else if (max > 1024) add(2, 'maxParticipants', 'O máximo é de 1.024 vagas.');
  else if (ctx.takenSlots !== undefined && max < ctx.takenSlots) add(2, 'maxParticipants', `Já existem ${ctx.takenSlots} vagas ocupadas. As vagas não podem ficar abaixo disso.`);

  const now = ctx.now.getTime();
  const opens = time(draft.registrationOpensAt);
  const closes = time(draft.registrationClosesAt);
  const starts = time(draft.startsAt);
  const lock = time(draft.rosterLockAt);
  if (starts === null) add(2, 'startsAt', 'Informe quando o campeonato começa.');
  else if (!ctx.alreadyPublished && starts <= now) add(2, 'startsAt', 'A data de início já passou. Escolha uma data futura.');
  if (closes === null) add(2, 'registrationClosesAt', 'Informe até quando as inscrições ficam abertas.');
  else if (!ctx.alreadyPublished && closes <= now) add(2, 'registrationClosesAt', 'O prazo de inscrição já passou. Escolha uma data futura.');
  else if (starts !== null && closes > starts) add(2, 'registrationClosesAt', 'As inscrições precisam fechar antes do início do campeonato.');
  if (opens !== null && closes !== null && opens >= closes) add(2, 'registrationOpensAt', 'A abertura das inscrições precisa ser antes do fechamento.');
  if (lock !== null && starts !== null && lock > starts) add(2, 'rosterLockAt', 'A trava de elenco precisa ser antes do início do campeonato.');
  if (draft.checkIn.enabled && draft.checkIn.closesMinutesBefore >= draft.checkIn.opensMinutesBefore) {
    add(2, 'checkIn.closesMinutesBefore', 'O check-in precisa fechar depois de abrir: o fechamento tem de ser mais perto da partida que a abertura.');
  }

  // Passos 3 e 4 — Fases e pontuação
  if (draft.stages.length === 0) {
    add(3, 'stages', 'Adicione pelo menos uma fase.');
  } else if (Number.isInteger(max) && max >= 2) {
    for (const issue of validateStages(draft.stages, { maxParticipants: max, game, mode })) {
      const stageName = draft.stages[issue.stageIndex]?.name.trim() || `Fase ${issue.stageIndex + 1}`;
      const step = issue.field === 'scoring' || issue.field === 'tiebreakers' ? 4 : 3;
      add(step, `stages.${issue.stageIndex}.${issue.field}`, `${stageName}: ${issue.message}`, issue.stageIndex);
    }
  }

  // Passo 5 — Regras
  if (isRichTextEmpty(draft.rules)) add(5, 'rules', 'Escreva o regulamento: quem se inscreve precisa aceitá-lo.');

  return issues;
}
