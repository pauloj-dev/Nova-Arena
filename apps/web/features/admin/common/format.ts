import type { Role, UserStatus } from '@nova/schemas';
import { getFormat, getT } from '@/shared/i18n/core';
import { adminCommonMessages } from './messages';

/** "12.480" */
export function formatNumber(value: number): string {
  return getFormat().number(value);
}

/** Fração (0 a 1) como porcentagem: 0,083 → "8,3%". */
export function formatPercent(fraction: number): string {
  return getFormat().number(fraction, { style: 'percent', maximumFractionDigits: 1 });
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

/** Nome do papel na tela ("Administrador"). */
export function roleLabel(role: Role): string {
  return getT(adminCommonMessages, 'papeis')(role);
}

/** Nome do status da conta na tela ("Suspenso"). */
export function userStatusLabel(status: UserStatus): string {
  return getT(adminCommonMessages, 'statusConta')(status);
}
