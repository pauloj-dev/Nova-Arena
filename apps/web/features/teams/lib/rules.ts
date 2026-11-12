/**
 * Regras de squad e convite (PRD §12.1) como funções puras, usadas pela API simulada e pelas telas.
 */
import { TEAM_INVITE_TTL_HOURS, TEAM_LOGO_MAX_BYTES, type InviteStatus, type TeamInviteState } from '@nova/schemas';

const HOUR_MS = 3_600_000;

/** O convite vale por 72 horas a partir da criação. */
export function inviteExpiry(now: Date = new Date()): string {
  return new Date(now.getTime() + TEAM_INVITE_TTL_HOURS * HOUR_MS).toISOString();
}

/** Estado do convite para quem vai usá-lo. Convite pendente e vencido é `EXPIRED`, mesmo sem job que atualize o registro. */
export function inviteState(invite: { status: InviteStatus; expiresAt: string }, now: Date = new Date()): TeamInviteState {
  if (invite.status === 'PENDING') return Date.parse(invite.expiresAt) <= now.getTime() ? 'EXPIRED' : 'VALID';
  return invite.status;
}

/** Explica por que o convite não pode mais ser usado. Nulo quando ele ainda vale. */
export function inviteStateMessage(state: TeamInviteState): string | null {
  switch (state) {
    case 'VALID':
      return null;
    case 'EXPIRED':
      return 'Este convite expirou. Peça um novo convite ao capitão do squad.';
    case 'REVOKED':
      return 'Este convite foi cancelado pelo capitão. Peça um novo convite a ele.';
    case 'ACCEPTED':
      return 'Este convite já foi usado.';
    case 'DECLINED':
      return 'Este convite foi recusado. Se mudou de ideia, peça um novo ao capitão.';
  }
}

/** Código como a API guarda: 6 caracteres, maiúsculos, sem espaços. */
export function normalizeInviteCode(raw: string): string {
  return raw.trim().toUpperCase();
}
export function isInviteCodeShape(code: string): boolean {
  return /^[A-Z0-9]{6}$/.test(code);
}

/** Caminho da página pública do convite (o link compartilhado). */
export function invitePath(code: string): string {
  return `/squads/convite/${encodeURIComponent(code)}`;
}

// ── Limite de tentativas de código (força bruta) ─────────────────────
export const INVITE_ATTEMPT_LIMIT = 10;
export const INVITE_ATTEMPT_WINDOW_MS = 60_000;

/**
 * Janela deslizante de tentativas erradas. 6 caracteres de um alfabeto de 32 dão ~1 bilhão de códigos,
 * mas sem limite um script testa milhares por minuto: com 10 erros por minuto a busca fica inviável.
 * Na API real (B1) a chave é IP + conta, guardada no Upstash Redis.
 */
export class AttemptLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly limit = INVITE_ATTEMPT_LIMIT,
    private readonly windowMs = INVITE_ATTEMPT_WINDOW_MS,
  ) {}

  private recent(key: string, now: number): number[] {
    const list = (this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs);
    this.failures.set(key, list);
    return list;
  }

  /** Verdadeiro quando a chave já estourou o limite e deve receber 429. */
  isBlocked(key: string, now: number = Date.now()): boolean {
    return this.recent(key, now).length >= this.limit;
  }

  /** Registra uma tentativa com código inexistente. */
  fail(key: string, now: number = Date.now()): void {
    this.recent(key, now).push(now);
  }

  /** Segundos até a próxima tentativa ser aceita (para o cabeçalho `Retry-After`). */
  retryAfterSeconds(key: string, now: number = Date.now()): number {
    const oldest = this.recent(key, now)[0];
    return oldest === undefined ? 0 : Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
  }

  reset(): void {
    this.failures.clear();
  }
}

// ── Logo ─────────────────────────────────────────────────────────────
export const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';
const LOGO_TYPES = LOGO_ACCEPT.split(',');

/** Valida o arquivo escolhido antes de ler. Devolve a mensagem de erro ou nulo. */
export function validateLogoFile(file: { type: string; size: number }): string | null {
  if (!LOGO_TYPES.includes(file.type)) return 'Escolha uma imagem PNG, JPG, WebP ou GIF.';
  if (file.size > TEAM_LOGO_MAX_BYTES) return 'A imagem precisa ter no máximo 5 MB.';
  return null;
}

/** Valida o data URL que chega à API (o cliente pode ser burlado). Devolve a mensagem de erro ou nulo. */
export function validateLogoDataUrl(value: string): string | null {
  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
  if (!match || !LOGO_TYPES.includes(match[1] ?? '')) return 'Escolha uma imagem PNG, JPG, WebP ou GIF.';
  const base64 = match[2] ?? '';
  const bytes = Math.floor((base64.length * 3) / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
  if (bytes > TEAM_LOGO_MAX_BYTES) return 'A imagem precisa ter no máximo 5 MB.';
  return null;
}
