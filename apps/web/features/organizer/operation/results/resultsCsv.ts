/**
 * Importação de resultados de quedas por CSV (issue #48). Tudo puro: o arquivo é lido no navegador,
 * conferido contra as partidas da fase e só o que está certo é enviado, em lotes.
 * Formato: uma linha por squad e queda — grupo/sala, queda, squad, colocação e kills.
 */
import type { Match, ResultEntryInput } from '@nova/schemas';
import Papa from 'papaparse';
import { CSV_SEPARATOR, toCsv } from '../../lib/csv';

export const RESULTS_CSV_HEADER = ['grupo', 'queda', 'squad', 'colocacao', 'kills'];
/** Limite da API por chamada (`ImportResultsInput`). */
export const IMPORT_BATCH_SIZE = 50;
export const MAX_RESULT_LINES = 5000;

type Column = 'group' | 'drop' | 'team' | 'placement' | 'kills';
const COLUMN_ALIASES: Record<Column, string[]> = {
  group: ['grupo', 'sala', 'gruposala', 'group', 'lobby'],
  drop: ['queda', 'partida', 'rodada', 'drop', 'round'],
  team: ['squad', 'equipe', 'time', 'nome', 'jogador', 'participante', 'team'],
  placement: ['colocacao', 'posicao', 'lugar', 'placement', 'pos'],
  kills: ['kills', 'abates', 'eliminacoes'],
};
const ABSENT_WORDS = ['ausente', 'aus', 'faltou', 'wo', 'absent'];

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function detectDelimiter(text: string): string {
  const header = text.split(/\r?\n/).find((line) => line.trim() !== '') ?? '';
  const count = (delimiter: string) => header.split(delimiter).length - 1;
  return [CSV_SEPARATOR, ',', '\t'].reduce((best, candidate) => (count(candidate) > count(best) ? candidate : best), CSV_SEPARATOR);
}

/** Quedas (partidas de sala) de uma fase, na ordem grupo → queda. */
export function lobbyMatches(matches: readonly Match[]): Match[] {
  return matches
    .filter((m) => m.kind === 'LOBBY')
    .sort((a, b) => (a.groupName ?? '').localeCompare(b.groupName ?? '', 'pt-BR', { numeric: true }) || (a.dropIndex ?? a.round) - (b.dropIndex ?? b.round));
}

const dropNumber = (m: Match) => m.dropIndex ?? m.round;
const isPlayed = (m: Match) => m.status === 'VALIDATED' || m.status === 'WALKOVER';
const activeTeams = (m: Match) => m.participants.filter((p) => p.registrationId !== null && p.status === 'ACTIVE');

/** "Grupo A · Queda 2" */
export function dropLabel(m: Pick<Match, 'groupName' | 'roundLabel'>): string {
  return [m.groupName, m.roundLabel].filter(Boolean).join(' · ');
}

/** Modelo de CSV da fase: uma linha por squad e queda ainda sem resultado, com colocação e kills em branco. */
export function resultsCsvTemplate(matches: readonly Match[]): string {
  const rows: (string | number)[][] = [];
  for (const m of lobbyMatches(matches)) {
    if (isPlayed(m) || m.status === 'CANCELLED') continue;
    for (const p of activeTeams(m)) rows.push([m.groupName ?? '', dropNumber(m), p.name, '', '']);
  }
  return toCsv(RESULTS_CSV_HEADER, rows);
}

export interface ParsedResultLine {
  /** Linha do arquivo (o cabeçalho é a linha 1). */
  line: number;
  values: { group: string; drop: string; team: string; placement: string; kills: string };
  /** Partida a que a linha pertence, quando foi possível identificar. */
  matchId: string | null;
  /** Vazio = linha certa. */
  errors: string[];
}

export interface ParsedResultMatch {
  matchId: string;
  label: string;
  lines: number[];
  entries: ResultEntryInput[];
  /** Problemas da queda como um todo (squad faltando, queda já lançada). */
  errors: string[];
  /** Pode ser enviada: nenhuma linha com erro e nenhum problema na queda. */
  ready: boolean;
}

export interface ParsedResults {
  fatal: string | null;
  lines: ParsedResultLine[];
  matches: ParsedResultMatch[];
}

function int(value: string): number | null {
  const text = value.trim();
  if (text === '') return null;
  return /^-?\d+$/.test(text) ? Number.parseInt(text, 10) : Number.NaN;
}

/**
 * Lê o CSV e confere cada linha contra as quedas da fase: squad desconhecido, queda inexistente,
 * número inválido, colocação repetida na mesma queda. Linha com colocação e kills em branco é
 * ignorada (é assim que o modelo vem para as quedas que ainda não foram jogadas).
 */
export function parseResultsCsv(text: string, matches: readonly Match[]): ParsedResults {
  const empty = (fatal: string): ParsedResults => ({ fatal, lines: [], matches: [] });
  const clean = text.replace(/^﻿/, '');
  if (clean.trim() === '') return empty('O arquivo está vazio.');
  const lobbies = lobbyMatches(matches);
  if (lobbies.length === 0) return empty('Esta fase não tem quedas de Battle Royale para importar.');

  const table = Papa.parse<string[]>(clean, { header: false, skipEmptyLines: false, delimiter: detectDelimiter(clean) }).data;
  const headerIndex = table.findIndex((row) => row.some((cell) => cell.trim() !== ''));
  const header = table[headerIndex];
  if (!header) return empty('O arquivo está vazio.');

  const columns = new Map<Column, number>();
  header.forEach((cell, index) => {
    const key = normalize(cell);
    for (const column of Object.keys(COLUMN_ALIASES) as Column[]) {
      if (!columns.has(column) && COLUMN_ALIASES[column].includes(key)) columns.set(column, index);
    }
  });
  const required: [Column, string][] = [['drop', 'queda'], ['team', 'squad'], ['placement', 'colocacao'], ['kills', 'kills']];
  const absentColumns = required.filter(([column]) => !columns.has(column)).map(([, name]) => `"${name}"`);
  if (absentColumns.length > 0) {
    return empty(`Não encontramos ${absentColumns.length === 1 ? 'a coluna' : 'as colunas'} ${absentColumns.join(', ')} na primeira linha. Baixe o modelo de CSV desta fase para ver o formato.`);
  }
  const cell = (row: string[], column: Column) => {
    const index = columns.get(column);
    // O apóstrofo inicial é o que a exportação põe para o Excel não ler o nome como fórmula.
    return index === undefined ? '' : (row[index] ?? '').trim().replace(/^'(?=[=+\-@])/, '');
  };

  const groups = [...new Set(lobbies.map((m) => m.groupName ?? ''))];
  const singleGroup = groups.length === 1;
  const lines: ParsedResultLine[] = [];
  const byMatch = new Map<string, { match: Match; rows: { line: ParsedResultLine; registrationId: string; placement: number | null; kills: number; absent: boolean }[] }>();

  table.forEach((row, index) => {
    if (index <= headerIndex || row.every((c) => c.trim() === '')) return;
    const values = { group: cell(row, 'group'), drop: cell(row, 'drop'), team: cell(row, 'team'), placement: cell(row, 'placement'), kills: cell(row, 'kills') };
    // Queda ainda não jogada no modelo: colocação e kills em branco.
    if (values.placement === '' && values.kills === '') return;
    const parsed: ParsedResultLine = { line: index + 1, values, matchId: null, errors: [] };
    lines.push(parsed);

    const drop = int(values.drop);
    if (drop === null) parsed.errors.push('Falta o número da queda.');
    else if (!Number.isFinite(drop) || drop < 1) parsed.errors.push(`"${values.drop}" não é um número de queda válido.`);

    const groupKey = normalize(values.group);
    const inGroup = lobbies.filter((m) => (values.group === '' && singleGroup ? true : normalize(m.groupName ?? '') === groupKey));
    if (inGroup.length === 0) {
      parsed.errors.push(values.group === '' ? 'Falta o grupo ou a sala.' : `Grupo ou sala "${values.group}" não existe nesta fase.`);
    }
    const match = drop !== null && Number.isFinite(drop) ? inGroup.find((m) => dropNumber(m) === drop) : undefined;
    if (inGroup.length > 0 && drop !== null && Number.isFinite(drop) && drop >= 1 && !match) {
      parsed.errors.push(`A queda ${drop} não existe${values.group ? ` em ${values.group}` : ''}.`);
    }

    const absent = ABSENT_WORDS.includes(normalize(values.placement));
    const placement = absent ? null : int(values.placement);
    const kills = int(values.kills);
    if (!absent) {
      if (placement === null) parsed.errors.push('Falta a colocação.');
      else if (!Number.isFinite(placement)) parsed.errors.push(`Colocação "${values.placement}" não é um número.`);
      else if (placement < 1) parsed.errors.push('A colocação começa em 1.');
      else if (match && placement > match.participants.length) parsed.errors.push(`A colocação vai de 1 a ${match.participants.length} nesta sala.`);
    }
    if (kills === null) {
      if (!absent) parsed.errors.push('Faltam as kills.');
    } else if (!Number.isFinite(kills)) parsed.errors.push(`Kills "${values.kills}" não é um número.`);
    else if (kills < 0) parsed.errors.push('Kills não podem ser negativas.');
    else if (kills > 999) parsed.errors.push('O máximo de kills é 999.');

    if (values.team === '') parsed.errors.push('Falta o nome do squad.');
    if (!match) return;
    parsed.matchId = match.id;
    const bucket = byMatch.get(match.id) ?? { match, rows: [] };
    byMatch.set(match.id, bucket);
    if (values.team === '') return;
    const teamKey = normalize(values.team);
    const team = match.participants.find((p) => p.registrationId !== null && (normalize(p.name) === teamKey || (p.tag !== null && normalize(p.tag) === teamKey)));
    if (!team?.registrationId) {
      parsed.errors.push(`Squad "${values.team}" não está nesta sala.`);
      return;
    }
    if (team.status !== 'ACTIVE') {
      parsed.errors.push(`${team.name} saiu do campeonato e não entra mais nas quedas.`);
      return;
    }
    const repeated = bucket.rows.find((r) => r.registrationId === team.registrationId);
    if (repeated) {
      parsed.errors.push(`${team.name} aparece duas vezes nesta queda (também na linha ${repeated.line.line}).`);
      return;
    }
    bucket.rows.push({ line: parsed, registrationId: team.registrationId, placement: placement !== null && Number.isFinite(placement) ? placement : null, kills: kills !== null && Number.isFinite(kills) ? kills : 0, absent });
  });

  if (lines.length === 0) return empty('O arquivo não tem nenhuma linha com colocação e kills preenchidas.');
  if (lines.length > MAX_RESULT_LINES) return empty(`O arquivo tem ${lines.length} linhas. O máximo por importação é de ${MAX_RESULT_LINES}.`);

  const parsedMatches: ParsedResultMatch[] = [];
  for (const { match, rows } of byMatch.values()) {
    // Colocação repetida na mesma queda: o erro vai para todas as linhas envolvidas.
    const byPlacement = new Map<number, typeof rows>();
    for (const r of rows) if (!r.absent && r.placement !== null) byPlacement.set(r.placement, [...(byPlacement.get(r.placement) ?? []), r]);
    for (const [placement, same] of byPlacement) {
      if (same.length < 2) continue;
      for (const r of same) {
        const others = same.filter((x) => x !== r).map((x) => `linha ${x.line.line}`);
        r.line.errors.push(`Colocação ${placement} repetida nesta queda (também na ${others.join(' e na ')}).`);
      }
    }
    const matchLines = lines.filter((l) => l.matchId === match.id);
    const errors: string[] = [];
    if (isPlayed(match)) errors.push('Esta queda já tem resultado. Para mudar, corrija pelo formulário, informando o motivo.');
    if (match.status === 'CANCELLED') errors.push('Esta queda foi cancelada.');
    const missing = activeTeams(match).filter((p) => !rows.some((r) => r.registrationId === p.registrationId));
    if (missing.length > 0 && matchLines.every((l) => l.errors.length === 0)) {
      errors.push(`${missing.length === 1 ? 'Falta 1 squad' : `Faltam ${missing.length} squads`} nesta queda: ${missing.map((p) => p.name).join(', ')}.`);
    }
    const ready = errors.length === 0 && matchLines.every((l) => l.errors.length === 0);
    parsedMatches.push({
      matchId: match.id,
      label: dropLabel(match),
      lines: matchLines.map((l) => l.line),
      entries: rows.map((r): ResultEntryInput => (r.absent ? { registrationId: r.registrationId, absent: true } : { registrationId: r.registrationId, placement: r.placement ?? 0, kills: r.kills })),
      errors,
      ready,
    });
  }
  const order = new Map(lobbies.map((m, i) => [m.id, i]));
  parsedMatches.sort((a, b) => (order.get(a.matchId) ?? 0) - (order.get(b.matchId) ?? 0));
  return { fatal: null, lines, matches: parsedMatches };
}

/** Quedas prontas para enviar, no formato da API. */
export function importableResults(parsed: ParsedResults): { matchId: string; entries: ResultEntryInput[] }[] {
  return parsed.matches.filter((m) => m.ready).map((m) => ({ matchId: m.matchId, entries: m.entries }));
}

/** Divide o envio em lotes do tamanho que a API aceita. */
export function chunk<T>(items: readonly T[], size: number = IMPORT_BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
