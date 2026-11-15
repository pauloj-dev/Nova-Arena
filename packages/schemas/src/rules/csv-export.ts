/**
 * CSV de inscritos: exportação (para abrir certo no Excel em pt-BR) e leitura do arquivo de importação.
 * Tudo puro — a exportação é montada pela API e a importação é lida no navegador, antes de enviar.
 */
import type { Registration, RegistrationStatus } from '../registration';

/** O Excel em pt-BR separa colunas por ponto e vírgula e só reconhece UTF-8 com BOM. */
export const CSV_SEPARATOR = ';';
export const UTF8_BOM = '﻿';
export const MAX_IMPORT_ROWS = 1024;

type Cell = string | number | null | undefined;

/** Célula que começa com =, +, - ou @ é lida como fórmula pelo Excel: o apóstrofo neutraliza. */
function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
function escapeCell(cell: Cell): string {
  if (cell === null || cell === undefined) return '';
  const text = typeof cell === 'number' ? String(cell) : neutralizeFormula(cell);
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Monta o CSV com BOM, `;` e quebras de linha do Windows. */
export function toCsv(header: string[], rows: Cell[][]): string {
  const lines = [header, ...rows].map((row) => row.map(escapeCell).join(CSV_SEPARATOR));
  return `${UTF8_BOM}${lines.join('\r\n')}\r\n`;
}

export const REGISTRATION_STATUS_LABEL: Record<RegistrationStatus, string> = {
  PENDING_MEMBERS: 'Aguardando membros',
  PENDING_APPROVAL: 'Aguardando aprovação',
  CONFIRMED: 'Confirmada',
  WAITLIST: 'Lista de espera',
  REJECTED: 'Recusada',
  CANCELLED: 'Cancelada',
  WITHDRAWN: 'Desistência',
  DISQUALIFIED: 'Desclassificada',
};

export type RegistrationKind = 'Squad' | 'Solo' | 'Importada';
export function registrationKind(r: Pick<Registration, 'teamId' | 'userId'>): RegistrationKind {
  if (r.teamId) return 'Squad';
  return r.userId ? 'Solo' : 'Importada';
}

/** Membros que já confirmaram presença. */
export function confirmedMembers(r: Pick<Registration, 'members'>): number {
  return r.members.filter((m) => m.confirmedAt !== null).length;
}

export interface RegistrationExportRow extends Pick<Registration, 'displayName' | 'tag' | 'teamId' | 'userId' | 'status' | 'members' | 'requiredMembers' | 'waitlistPosition' | 'statusReason' | 'createdAt'> {
  /** Só nas inscrições importadas por CSV. */
  contact?: string | null;
  gameAccountId?: string | null;
}

export const EXPORT_HEADER = ['Nome', 'Tag', 'Tipo', 'Status', 'Membros confirmados', 'Membros', 'Posição na lista de espera', 'Motivo', 'Inscrição em', 'Contato', 'ID no jogo'];

function formatCsvDate(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('pt-BR', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}

/** Exportação dos inscritos. As datas saem no fuso informado (padrão: horário de Brasília). */
export function registrationsToCsv(rows: RegistrationExportRow[], timeZone = 'America/Sao_Paulo'): string {
  return toCsv(
    EXPORT_HEADER,
    rows.map((r) => [
      r.displayName,
      r.tag ?? '',
      registrationKind(r),
      REGISTRATION_STATUS_LABEL[r.status],
      r.teamId ? `${confirmedMembers(r)}/${r.requiredMembers}` : '',
      r.members.map((m) => m.nickname).join(', '),
      r.waitlistPosition,
      r.statusReason ?? '',
      formatCsvDate(r.createdAt, timeZone),
      r.contact ?? '',
      r.gameAccountId ?? '',
    ]),
  );
}
