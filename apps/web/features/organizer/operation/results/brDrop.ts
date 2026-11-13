/**
 * Regras do formulário de queda de Battle Royale (US-ORG-07), como funções puras:
 * leitura dos campos, validação ao vivo, prévia dos pontos pelo motor e montagem do envio.
 * O que vale é o cálculo do servidor (RN-01): a prévia usa o mesmo motor, com o mesmo modelo.
 */
import { computePoints, type Rule } from '@nova/engine';
import type { Match, ResultEntryInput } from '@nova/schemas';

export interface DropMember {
  userId: string;
  nickname: string;
}

/** Uma linha do formulário. Os campos ficam como texto, do jeito que a pessoa digitou. */
export interface DropRow {
  registrationId: string;
  name: string;
  tag: string | null;
  placement: string;
  kills: string;
  absent: boolean;
  /** Kills por jogador (RN-03): userId → texto digitado. */
  playerKills: Record<string, string>;
}

export interface DropRowErrors {
  placement?: string;
  kills?: string;
  playerKills?: string;
}

export interface DropValidation {
  errors: Record<string, DropRowErrors>;
  /** Há campo obrigatório ainda em branco (não é erro enquanto a pessoa digita). */
  missing: number;
  /** Nada errado e nada faltando: pode enviar. */
  valid: boolean;
}

export interface DropContext {
  rules: Rule[];
  /** Número desta queda (começa em 1) e total de quedas da sala, para o multiplicador "última queda". */
  dropIndex: number;
  dropCount: number;
  multiplier: number;
}

/** Lê um campo numérico. Vazio = nulo; qualquer coisa que não seja inteiro = NaN. */
export function parseCount(value: string): number | null {
  const text = value.trim();
  if (text === '') return null;
  return /^-?\d+$/.test(text) ? Number.parseInt(text, 10) : Number.NaN;
}

/** Equipes que entram no lançamento: quem desistiu ou foi desclassificado fica de fora da queda. */
export function rowsFromMatch(match: Match): DropRow[] {
  return match.participants
    .filter((p) => p.registrationId !== null && p.status === 'ACTIVE')
    .map((p) => ({
      registrationId: p.registrationId as string,
      name: p.name,
      tag: p.tag,
      placement: p.absent || p.placement === null ? '' : String(p.placement),
      kills: p.absent || p.kills === null ? '' : String(p.kills),
      absent: p.absent,
      playerKills: Object.fromEntries(Object.entries(p.playerKills).map(([userId, kills]) => [userId, String(kills)])),
    }));
}

export function playerKillsSum(row: DropRow, members: DropMember[]): number {
  return members.reduce((sum, m) => {
    const n = parseCount(row.playerKills[m.userId] ?? '');
    return sum + (n !== null && Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);
}

/**
 * Validação ao vivo: colocação repetida, fora da sala ou negativa; kills negativas ou não inteiras;
 * soma das kills por jogador diferente das kills da equipe (RN-03). Campo em branco só conta como
 * "faltando" — vira erro na hora de enviar.
 */
export function validateDrop(rows: DropRow[], opts: { killsPerPlayer?: boolean; members?: Record<string, DropMember[]> } = {}): DropValidation {
  const errors: Record<string, DropRowErrors> = {};
  const set = (id: string, field: keyof DropRowErrors, message: string) => {
    errors[id] = { ...errors[id], [field]: message };
  };
  const total = rows.length;
  let missing = 0;

  const byPlacement = new Map<number, DropRow[]>();
  for (const row of rows) {
    if (row.absent) continue;
    const placement = parseCount(row.placement);
    if (placement === null) missing += 1;
    else if (!Number.isFinite(placement)) set(row.registrationId, 'placement', 'Use um número inteiro');
    else if (placement < 1) set(row.registrationId, 'placement', 'A colocação começa em 1');
    else if (placement > total) set(row.registrationId, 'placement', `Esta sala tem ${total} ${total === 1 ? 'equipe' : 'equipes'}: a colocação vai de 1 a ${total}`);
    else byPlacement.set(placement, [...(byPlacement.get(placement) ?? []), row]);

    const kills = parseCount(row.kills);
    if (kills === null) missing += 1;
    else if (!Number.isFinite(kills)) set(row.registrationId, 'kills', 'Use um número inteiro');
    else if (kills < 0) set(row.registrationId, 'kills', 'Kills não podem ser negativas');
    else if (kills > 999) set(row.registrationId, 'kills', 'O máximo é 999');

    const members = opts.killsPerPlayer ? (opts.members?.[row.registrationId] ?? []) : [];
    if (members.length > 0) {
      const typed = members.map((m) => parseCount(row.playerKills[m.userId] ?? ''));
      if (typed.some((n) => n !== null && (!Number.isFinite(n) || n < 0))) {
        set(row.registrationId, 'playerKills', 'As kills de cada jogador precisam ser um número inteiro a partir de 0');
      } else if (kills !== null && Number.isFinite(kills) && kills >= 0) {
        const sum = playerKillsSum(row, members);
        if (sum !== kills) set(row.registrationId, 'playerKills', `A soma por jogador (${sum}) precisa ser igual às kills da equipe (${kills})`);
      }
    }
  }
  for (const [placement, same] of byPlacement) {
    if (same.length < 2) continue;
    for (const row of same) {
      const others = same.filter((r) => r !== row).map((r) => r.name);
      set(row.registrationId, 'placement', `Colocação ${placement} repetida (também em ${others.join(', ')})`);
    }
  }
  return { errors, missing, valid: missing === 0 && Object.keys(errors).length === 0 };
}

/** Prévia dos pontos de uma linha, pelo motor. Nulo enquanto a linha não tem colocação e kills válidas. */
export function previewPoints(row: DropRow, ctx: DropContext, total: number): number | null {
  if (row.absent) return 0;
  const placement = parseCount(row.placement);
  const kills = parseCount(row.kills);
  if (placement === null || kills === null || !Number.isFinite(placement) || !Number.isFinite(kills)) return null;
  if (placement < 1 || placement > total || kills < 0) return null;
  return computePoints({ kills, placement }, ctx.rules, { matchIndex: ctx.dropIndex, matchCount: ctx.dropCount, multiplier: ctx.multiplier }).total;
}

/** Corpo do envio: só estatísticas brutas (RN-01). Chamar apenas com o formulário válido. */
export function toEntries(rows: DropRow[], opts: { killsPerPlayer?: boolean; members?: Record<string, DropMember[]> } = {}): ResultEntryInput[] {
  return rows.map((row) => {
    if (row.absent) return { registrationId: row.registrationId, absent: true };
    const entry: ResultEntryInput = { registrationId: row.registrationId, placement: parseCount(row.placement) ?? 0, kills: parseCount(row.kills) ?? 0 };
    const members = opts.killsPerPlayer ? (opts.members?.[row.registrationId] ?? []) : [];
    if (members.length > 0) entry.playerKills = Object.fromEntries(members.map((m) => [m.userId, Math.max(0, parseCount(row.playerKills[m.userId] ?? '') ?? 0)]));
    return entry;
  });
}

/** Atalho "preencher colocações na ordem": 1, 2, 3… na ordem em que as equipes aparecem, pulando as ausentes. */
export function fillPlacementsInOrder(rows: DropRow[]): DropRow[] {
  let next = 0;
  return rows.map((row) => {
    if (row.absent) return row;
    next += 1;
    return { ...row, placement: String(next) };
  });
}

/** Ordem pela colocação: quem já tem colocação primeiro (da menor para a maior), depois os em branco e os ausentes, sem embaralhar. */
export function sortByPlacement(rows: DropRow[]): DropRow[] {
  const rank = (row: DropRow) => {
    if (row.absent) return Number.MAX_SAFE_INTEGER;
    const n = parseCount(row.placement);
    return n !== null && Number.isFinite(n) && n >= 1 ? n : Number.MAX_SAFE_INTEGER - 1;
  };
  return rows.map((row, index) => ({ row, index })).sort((a, b) => rank(a.row) - rank(b.row) || a.index - b.index).map((x) => x.row);
}

// ── Rascunho local (sobrevive a recarregar a página) ─────────────────
const DRAFT_PREFIX = 'nova:rascunho-queda:';

export interface DropDraft {
  rows: Pick<DropRow, 'registrationId' | 'placement' | 'kills' | 'absent' | 'playerKills'>[];
  savedAt: string;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function saveDropDraft(matchId: string, rows: DropRow[], now: Date = new Date()): boolean {
  const draft: DropDraft = { rows: rows.map(({ registrationId, placement, kills, absent, playerKills }) => ({ registrationId, placement, kills, absent, playerKills })), savedAt: now.toISOString() };
  try {
    storage()?.setItem(`${DRAFT_PREFIX}${matchId}`, JSON.stringify(draft));
    return storage() !== null;
  } catch {
    return false;
  }
}

export function loadDropDraft(matchId: string): DropDraft | null {
  try {
    const raw = storage()?.getItem(`${DRAFT_PREFIX}${matchId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DropDraft>;
    return Array.isArray(parsed.rows) && typeof parsed.savedAt === 'string' ? (parsed as DropDraft) : null;
  } catch {
    return null;
  }
}

export function clearDropDraft(matchId: string): void {
  try {
    storage()?.removeItem(`${DRAFT_PREFIX}${matchId}`);
  } catch {
    // Sem armazenamento local: não havia rascunho para apagar.
  }
}

/** Aplica o rascunho salvo sobre as linhas da partida (equipes que saíram da sala são ignoradas). */
export function applyDraft(rows: DropRow[], draft: DropDraft | null): DropRow[] {
  if (!draft) return rows;
  const saved = new Map(draft.rows.map((r) => [r.registrationId, r]));
  return rows.map((row) => {
    const s = saved.get(row.registrationId);
    return s ? { ...row, placement: s.placement, kills: s.kills, absent: s.absent, playerKills: s.playerKills ?? {} } : row;
  });
}
