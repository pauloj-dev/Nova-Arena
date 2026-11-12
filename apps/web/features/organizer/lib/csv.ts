/**
 * CSV de inscritos: exportação (para abrir certo no Excel em pt-BR) e leitura do arquivo de importação.
 * Tudo puro — a exportação é montada pela API e a importação é lida no navegador, antes de enviar.
 */
import type { ImportRegistrationRow, Registration, RegistrationStatus } from '@nova/schemas';
import Papa from 'papaparse';

/** O Excel em pt-BR separa colunas por ponto e vírgula e só reconhece UTF-8 com BOM. */
export const CSV_SEPARATOR = ';';
export const UTF8_BOM = '﻿';
export const MAX_IMPORT_ROWS = 1024;
const MAX_NAME_LENGTH = 60;
const MAX_TAG_LENGTH = 5;

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

// ── Importação ───────────────────────────────────────────────────────

export const IMPORT_HEADER = ['nome', 'tag', 'contato', 'id_no_jogo'];

/** Modelo de CSV para baixar, com duas linhas de exemplo. */
export function registrationsCsvTemplate(isTeam: boolean): string {
  return toCsv(
    IMPORT_HEADER,
    isTeam
      ? [
          ['Squad Exemplo', 'EXEM', 'capitao@exemplo.com', '1234567890'],
          ['Squad Modelo', 'MODE', '(11) 90000-0000', ''],
        ]
      : [
          ['JogadorExemplo', '', 'jogador@exemplo.com', '1234567890'],
          ['OutroJogador', '', '(11) 90000-0000', ''],
        ],
  );
}

type ImportColumn = keyof ImportRegistrationRow;
const COLUMN_ALIASES: Record<ImportColumn, string[]> = {
  name: ['nome', 'name', 'squad', 'equipe', 'time', 'jogador', 'nick', 'apelido', 'participante'],
  tag: ['tag', 'sigla'],
  contact: ['contato', 'contact', 'whatsapp', 'telefone', 'email'],
  gameId: ['idnojogo', 'iddojogo', 'idjogo', 'idjogador', 'gameid', 'id'],
};

function normalizeHeader(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** O separador é o que mais aparece no cabeçalho (`;` do Excel em pt-BR, `,` ou tabulação). */
function detectDelimiter(text: string): string {
  const header = text.split(/\r?\n/).find((line) => line.trim() !== '') ?? '';
  const count = (delimiter: string) => header.split(delimiter).length - 1;
  return [CSV_SEPARATOR, ',', '\t'].reduce((best, candidate) => (count(candidate) > count(best) ? candidate : best), CSV_SEPARATOR);
}

export interface ParsedImportLine {
  /** Linha do arquivo (o cabeçalho é a linha 1). */
  line: number;
  values: { name: string; tag: string; contact: string; gameId: string };
  /** Vazio = linha pronta para enviar. */
  errors: string[];
}

export interface ParsedImport {
  /** Problema que impede ler o arquivo (sem coluna de nome, vazio…). */
  fatal: string | null;
  lines: ParsedImportLine[];
}

/**
 * Lê o CSV de importação. Aceita `;`, `,` ou tabulação, com ou sem BOM, e cabeçalho em português
 * ou inglês. Devolve todas as linhas com os erros de cada uma, para a prévia antes do envio.
 */
export function parseRegistrationsCsv(text: string): ParsedImport {
  const clean = text.replace(/^﻿/, '');
  if (clean.trim() === '') return { fatal: 'O arquivo está vazio.', lines: [] };

  const parsed = Papa.parse<string[]>(clean, { header: false, skipEmptyLines: false, delimiter: detectDelimiter(clean) });
  const table = parsed.data;
  const headerIndex = table.findIndex((row) => row.some((cell) => cell.trim() !== ''));
  const header = table[headerIndex];
  if (!header) return { fatal: 'O arquivo está vazio.', lines: [] };

  const columns = new Map<ImportColumn, number>();
  header.forEach((cell, index) => {
    const key = normalizeHeader(cell);
    for (const column of Object.keys(COLUMN_ALIASES) as ImportColumn[]) {
      if (!columns.has(column) && COLUMN_ALIASES[column].includes(key)) columns.set(column, index);
    }
  });
  if (!columns.has('name')) {
    return { fatal: 'Não encontramos a coluna "nome" na primeira linha. Baixe o modelo de CSV para ver o formato.', lines: [] };
  }

  const cell = (row: string[], column: ImportColumn) => {
    const index = columns.get(column);
    return index === undefined ? '' : (row[index] ?? '').trim();
  };

  const lines: ParsedImportLine[] = [];
  const firstLineByName = new Map<string, number>();
  table.forEach((row, index) => {
    if (index <= headerIndex) return;
    if (row.every((c) => c.trim() === '')) return;
    const line = index + 1;
    const values = { name: cell(row, 'name'), tag: cell(row, 'tag'), contact: cell(row, 'contact'), gameId: cell(row, 'gameId') };
    const errors: string[] = [];
    if (values.name === '') errors.push('Falta o nome.');
    else if (values.name.length > MAX_NAME_LENGTH) errors.push(`O nome pode ter no máximo ${MAX_NAME_LENGTH} caracteres.`);
    if (values.tag.length > MAX_TAG_LENGTH) errors.push(`A tag pode ter no máximo ${MAX_TAG_LENGTH} caracteres.`);
    if (values.name !== '') {
      const key = values.name.toLowerCase();
      const first = firstLineByName.get(key);
      if (first !== undefined) errors.push(`Nome repetido no arquivo (já aparece na linha ${first}).`);
      else firstLineByName.set(key, line);
    }
    lines.push({ line, values, errors });
  });

  if (lines.length === 0) return { fatal: 'O arquivo só tem o cabeçalho. Adicione pelo menos um inscrito.', lines: [] };
  if (lines.length > MAX_IMPORT_ROWS) {
    return { fatal: `O arquivo tem ${lines.length} linhas. O máximo por importação é de ${MAX_IMPORT_ROWS}.`, lines: [] };
  }
  return { fatal: null, lines };
}

/** Linhas sem erro, no formato que a API espera, com a linha do arquivo de cada uma. */
export function importableRows(parsed: ParsedImport): { rows: ImportRegistrationRow[]; fileLines: number[] } {
  const ok = parsed.lines.filter((l) => l.errors.length === 0);
  return {
    rows: ok.map((l) => ({
      name: l.values.name,
      ...(l.values.tag ? { tag: l.values.tag } : {}),
      ...(l.values.contact ? { contact: l.values.contact } : {}),
      ...(l.values.gameId ? { gameId: l.values.gameId } : {}),
    })),
    fileLines: ok.map((l) => l.line),
  };
}
