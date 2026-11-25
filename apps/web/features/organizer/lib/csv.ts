/** CSV de inscritos. A exportação é compartilhada com a API (`@nova/schemas`); a leitura do arquivo (papaparse) fica na tela. */
import type { ImportRegistrationRow, ModeSize } from '@nova/schemas';
import { CSV_SEPARATOR, GUEST_GAME_ID_MAX, GUEST_NAME_MAX, guestRosterProblem, MAX_IMPORT_ROWS, toCsv } from '@nova/schemas';
import Papa from 'papaparse';
import { getT } from '@/shared/i18n/core';
import { messages } from '../messages';

export * from '@nova/schemas';

const MAX_NAME_LENGTH = 60;
const MAX_TAG_LENGTH = 5;

// ── Importação ───────────────────────────────────────────────────────

export const IMPORT_HEADER = ['nome', 'tag', 'contato', 'id_no_jogo'];

/** Titulares e reservas do modo do campeonato: é o que define as colunas de elenco da planilha (RN-18). */
export type RosterShape = ModeSize;

interface RosterSlot {
  isSub: boolean;
  /** Posição dentro do grupo (jogador_1, jogador_2… / reserva_1…). */
  index: number;
  nameHeader: string;
  idHeader: string;
}

/** Colunas de elenco do modo: `jogador_N` + `id_jogador_N` por titular e `reserva_N` + `id_reserva_N` por reserva. */
function rosterSlots(roster: RosterShape): RosterSlot[] {
  return [
    ...Array.from({ length: roster.teamSize }, (_, i) => ({ isSub: false, index: i + 1, nameHeader: `jogador_${i + 1}`, idHeader: `id_jogador_${i + 1}` })),
    ...Array.from({ length: roster.maxSubs }, (_, i) => ({ isSub: true, index: i + 1, nameHeader: `reserva_${i + 1}`, idHeader: `id_reserva_${i + 1}` })),
  ];
}

/** Cabeçalho da planilha de importação. Em campeonato por squad (`roster`), com as colunas do elenco. */
export function importHeader(roster: RosterShape | null = null): string[] {
  return [...IMPORT_HEADER, ...(roster ? rosterSlots(roster).flatMap((slot) => [slot.nameHeader, slot.idHeader]) : [])];
}

/**
 * Modelo de CSV para baixar, com duas linhas de exemplo. Com `roster` (campeonato por squad), o modelo traz o
 * elenco: a primeira linha completa e a segunda só com parte dos jogadores, para mostrar que é opcional.
 */
export function registrationsCsvTemplate(isTeam: boolean, roster: RosterShape | null = null): string {
  const slots = isTeam && roster ? rosterSlots(roster) : [];
  const example = (prefix: string, filled: number) => slots.flatMap((slot, i) => (i < filled ? [`${prefix}${slot.isSub ? 'Reserva' : 'Jogador'}${slot.index}`, String(1000000001 + i + (prefix === 'Mode' ? 50 : 0))] : ['', '']));
  return toCsv(
    importHeader(isTeam ? roster : null),
    isTeam
      ? [
          ['Squad Exemplo', 'EXEM', 'capitao@exemplo.com', '1234567890', ...example('Exem', slots.length)],
          ['Squad Modelo', 'MODE', '(11) 90000-0000', '', ...example('Mode', Math.min(2, slots.length))],
        ]
      : [
          ['JogadorExemplo', '', 'jogador@exemplo.com', '1234567890'],
          ['OutroJogador', '', '(11) 90000-0000', ''],
        ],
  );
}

type ImportColumn = 'name' | 'tag' | 'contact' | 'gameId';
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

const STARTER = '(?:jogador|player|titular|membro)';
const SUB = '(?:reserva|sub|suplente)';
const ID = 'id(?:nojogo|dojogo|jogo)?';
/** Coluna de elenco pelo cabeçalho já normalizado: `jogador1`, `idjogador1`, `reserva1`, `idreserva1` (e variações). */
function rosterColumn(key: string): { isSub: boolean; index: number; field: 'name' | 'id' } | null {
  const patterns: [RegExp, boolean, 'name' | 'id'][] = [
    [new RegExp(`^${STARTER}(\\d+)$`), false, 'name'],
    [new RegExp(`^${ID}${STARTER}(\\d+)$`), false, 'id'],
    [new RegExp(`^${STARTER}(\\d+)id$`), false, 'id'],
    [new RegExp(`^${SUB}(\\d*)$`), true, 'name'],
    [new RegExp(`^${ID}${SUB}(\\d*)$`), true, 'id'],
    [new RegExp(`^${SUB}(\\d*)id$`), true, 'id'],
  ];
  for (const [pattern, isSub, field] of patterns) {
    const match = pattern.exec(key);
    if (match) return { isSub, index: Number(match[1] || '1'), field };
  }
  return null;
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
  /** Elenco da linha (só em campeonato por squad). */
  members: { name: string; gameId: string; isSub: boolean }[];
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
 * Com `roster` (campeonato por squad), lê também as colunas de elenco e confere com o modo (RN-18);
 * sem ele, essas colunas são ignoradas.
 */
export function parseRegistrationsCsv(text: string, roster: RosterShape | null = null): ParsedImport {
  const t = getT(messages, 'csv');
  const clean = text.replace(/^﻿/, '');
  if (clean.trim() === '') return { fatal: t('vazio'), lines: [] };

  const parsed = Papa.parse<string[]>(clean, { header: false, skipEmptyLines: false, delimiter: detectDelimiter(clean) });
  const table = parsed.data;
  const headerIndex = table.findIndex((row) => row.some((cell) => cell.trim() !== ''));
  const header = table[headerIndex];
  if (!header) return { fatal: t('vazio'), lines: [] };

  const columns = new Map<ImportColumn, number>();
  /** Colunas de elenco: uma vaga por (titular/reserva, número), com a coluna do nome e a do ID. */
  const slots = new Map<string, { isSub: boolean; index: number; idLabel: string; name?: number; id?: number }>();
  header.forEach((cell, index) => {
    const key = normalizeHeader(cell);
    for (const column of Object.keys(COLUMN_ALIASES) as ImportColumn[]) {
      if (!columns.has(column) && COLUMN_ALIASES[column].includes(key)) {
        columns.set(column, index);
        return;
      }
    }
    const slot = roster ? rosterColumn(key) : null;
    if (!slot) return;
    const slotKey = `${slot.isSub ? 'r' : 's'}${slot.index}`;
    const entry = slots.get(slotKey) ?? { isSub: slot.isSub, index: slot.index, idLabel: '' };
    if (slot.field === 'name') entry.name ??= index;
    else if (entry.id === undefined) {
      entry.id = index;
      entry.idLabel = cell.trim();
    }
    slots.set(slotKey, entry);
  });
  if (!columns.has('name')) {
    return { fatal: t('semColunaNome'), lines: [] };
  }
  const orderedSlots = [...slots.values()].sort((a, b) => Number(a.isSub) - Number(b.isSub) || a.index - b.index);

  const cell = (row: string[], column: ImportColumn) => {
    const index = columns.get(column);
    return index === undefined ? '' : (row[index] ?? '').trim();
  };
  const at = (row: string[], index: number | undefined) => (index === undefined ? '' : (row[index] ?? '').trim());

  const lines: ParsedImportLine[] = [];
  const firstLineByName = new Map<string, number>();
  table.forEach((row, index) => {
    if (index <= headerIndex) return;
    if (row.every((c) => c.trim() === '')) return;
    const line = index + 1;
    const values = { name: cell(row, 'name'), tag: cell(row, 'tag'), contact: cell(row, 'contact'), gameId: cell(row, 'gameId') };
    const errors: string[] = [];
    if (values.name === '') errors.push(t('faltaNome'));
    else if (values.name.length > MAX_NAME_LENGTH) errors.push(t('nomeLongo', { max: String(MAX_NAME_LENGTH) }));
    if (values.tag.length > MAX_TAG_LENGTH) errors.push(t('tagLonga', { max: String(MAX_TAG_LENGTH) }));
    if (values.name !== '') {
      const key = values.name.toLowerCase();
      const first = firstLineByName.get(key);
      if (first !== undefined) errors.push(t('nomeRepetido', { linha: String(first) }));
      else firstLineByName.set(key, line);
    }

    const members: ParsedImportLine['members'] = [];
    for (const slot of orderedSlots) {
      const name = at(row, slot.name);
      const gameId = at(row, slot.id);
      if (name === '') {
        if (gameId !== '') errors.push(t('idSemJogador', { coluna: slot.idLabel }));
        continue;
      }
      if (name.length > GUEST_NAME_MAX) errors.push(t('jogadorLongo', { nome: name, max: String(GUEST_NAME_MAX) }));
      if (gameId.length > GUEST_GAME_ID_MAX) errors.push(t('idLongo', { nome: name, max: String(GUEST_GAME_ID_MAX) }));
      members.push({ name, gameId, isSub: slot.isSub });
    }
    if (roster && members.length > 0) {
      const problem = guestRosterProblem(members, roster);
      if (problem) errors.push(problem);
    }
    lines.push({ line, values, members, errors });
  });

  if (lines.length === 0) return { fatal: t('soCabecalho'), lines: [] };
  if (lines.length > MAX_IMPORT_ROWS) {
    return { fatal: t('muitasLinhas', { linhas: String(lines.length), max: String(MAX_IMPORT_ROWS) }), lines: [] };
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
      ...(l.members.length > 0 ? { members: l.members.map((m) => ({ name: m.name, ...(m.gameId ? { gameId: m.gameId } : {}), ...(m.isSub ? { isSub: true } : {}) })) } : {}),
    })),
    fileLines: ok.map((l) => l.line),
  };
}
