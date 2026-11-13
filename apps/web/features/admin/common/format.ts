import type { Role, UserStatus } from '@nova/schemas';

const NUMBER = new Intl.NumberFormat('pt-BR');
const PERCENT = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });

/** "12.480" */
export function formatNumber(value: number): string {
  return NUMBER.format(value);
}

/** Fração (0 a 1) como porcentagem: 0,083 → "8,3%". */
export function formatPercent(fraction: number): string {
  return PERCENT.format(fraction);
}

/** "2026-11-12" → "12/11" (rótulo de eixo). A data já é um dia inteiro: não passa por fuso. */
export function formatDayShort(date: string): string {
  const [, month, day] = date.split('-');
  return `${day}/${month}`;
}

/** "2026-11-12" → "12/11/2026". */
export function formatDayLong(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Administrador',
  ORGANIZER: 'Organizador',
  PARTICIPANT: 'Participante',
};

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  ACTIVE: 'Ativo',
  SUSPENDED: 'Suspenso',
  BANNED: 'Banido',
  MERGED: 'Mesclado',
  DELETED: 'Excluído',
};

/** Plural simples: `plural(2, 'campeonato', 'campeonatos')` → "2 campeonatos". */
export function plural(count: number, one: string, many: string): string {
  return `${formatNumber(count)} ${count === 1 ? one : many}`;
}
