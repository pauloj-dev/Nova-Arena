/**
 * Comparação campo a campo do "antes" e do "depois" de um registro de auditoria.
 * Função pura: a tela (`AuditDiff`) só desenha o resultado.
 */
import { getFormat, getT } from '@/shared/i18n/core';
import { formatDateTime } from '@/shared/lib/datetime';
import { adminAuditMessages } from './messages';

export type AuditValues = Record<string, unknown> | null | undefined;

export interface DiffRow {
  key: string;
  label: string;
  before: string;
  after: string;
  /** `added`: só existe no depois · `removed`: só existia antes · `changed` · `same`. */
  kind: 'added' | 'removed' | 'changed' | 'same';
}

/** Rótulos dos campos e dos valores "de máquina" que aparecem nos registros: `diff.campos` e `diff.valores` do catálogo. */
const DIFF_TEXTS = adminAuditMessages['pt-BR'].diff;

function hasKey<T extends object>(map: T, key: string): key is Extract<keyof T, string> {
  return Object.prototype.hasOwnProperty.call(map, key);
}

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const EMPTY = '—';

/** "maxActiveTournaments" → "Max active tournaments" (para campos que ainda não têm rótulo). */
export function fieldLabel(key: string): string {
  if (hasKey(DIFF_TEXTS.campos, key)) return getT(adminAuditMessages, 'diff')(`campos.${key}`);
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Valor legível: sim/não, datas no fuso da pessoa, listas separadas por vírgula. */
export function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return EMPTY;
  const t = getT(adminAuditMessages, 'diff');
  if (typeof value === 'boolean') return value ? t('sim') : t('nao');
  if (typeof value === 'number') return getFormat().number(value);
  if (typeof value === 'string') {
    if (ISO_DATE_TIME.test(value)) return formatDateTime(value);
    return hasKey(DIFF_TEXTS.valores, value) ? t(`valores.${value}`) : value;
  }
  if (Array.isArray(value)) return value.length === 0 ? EMPTY : value.map(formatAuditValue).join(', ');
  return Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => `${fieldLabel(k)}: ${formatAuditValue(v)}`)
    .join('; ');
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Uma linha por campo que aparece no antes ou no depois, na ordem em que aparecem.
 * Os campos alterados vêm primeiro: é o que quem audita procura.
 */
export function diffAudit(before: AuditValues, after: AuditValues): DiffRow[] {
  const b = before ?? {};
  const a = after ?? {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  const rows = keys.map((key): DiffRow => {
    const inBefore = key in b && b[key] !== undefined;
    const inAfter = key in a && a[key] !== undefined;
    const kind: DiffRow['kind'] = !inBefore ? 'added' : !inAfter ? 'removed' : same(b[key], a[key]) ? 'same' : 'changed';
    return { key, label: fieldLabel(key), before: inBefore ? formatAuditValue(b[key]) : EMPTY, after: inAfter ? formatAuditValue(a[key]) : EMPTY, kind };
  });
  return [...rows.filter((r) => r.kind !== 'same'), ...rows.filter((r) => r.kind === 'same')];
}
