/**
 * Calendário (.ics, issue 125): "minhas partidas" e as partidas de um campeonato, no formato iCalendar (RFC 5545).
 *
 * Os horários vão sempre em UTC (`…Z`): o aplicativo de calendário mostra no fuso de quem assina, sem ambiguidade de
 * horário de verão. A assinatura por URL (webcal) se atualiza sozinha (`REFRESH-INTERVAL`, RFC 7986).
 *
 * O gerador é puro (sem Node nem DOM): a API real e a API simulada produzem o mesmo arquivo.
 */
import { z } from 'zod';
import type { Match } from './competition';

/** Endereços de um calendário (`GET /me/calendar` e `GET /tournaments/:id/calendar`). */
export const CalendarFeed = z.object({
  /** Endereço https do arquivo .ics (para colar em "Adicionar calendário por URL"). */
  url: z.string(),
  /** O mesmo endereço com `webcal://`: abre direto o aplicativo de calendário para assinar. */
  webcalUrl: z.string(),
  /** Nome sugerido para o arquivo baixado. */
  filename: z.string(),
  /** Quantas partidas com horário marcado o calendário tem agora. */
  events: z.number().int(),
});
export type CalendarFeed = z.infer<typeof CalendarFeed>;

export interface IcsEvent {
  /** Identificador estável: o mesmo evento é atualizado (não duplicado) quando a partida muda de horário. */
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description?: string;
  url?: string;
  status?: 'CONFIRMED' | 'CANCELLED' | 'TENTATIVE';
  lastModified?: Date;
  /** Lembrete antes do início, em minutos (padrão 15). `null` = sem lembrete. */
  alarmMinutes?: number | null;
}

export interface IcsCalendar {
  name: string;
  description?: string;
  /** Fuso de quem assina (IANA), só como dica para o aplicativo. Os horários continuam em UTC. */
  timeZone?: string | null;
  events: IcsEvent[];
  /** Carimbo de geração (DTSTAMP). */
  now: Date;
  /** De quanto em quanto tempo o aplicativo deve buscar de novo. Padrão: 60 min. */
  refreshMinutes?: number;
}

const pad = (n: number, size = 2) => String(n).padStart(size, '0');

/** `20261121T190000Z` */
export function icsDateTime(date: Date): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

/** Escapa um valor TEXT (RFC 5545 §3.3.11): barra invertida, ponto e vírgula, vírgula e quebra de linha. */
export function icsEscape(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

const encoder = new TextEncoder();

/** Dobra a linha em pedaços de até 75 bytes (RFC 5545 §3.1), sem partir um caractere UTF-8 ao meio. */
export function icsFold(line: string): string {
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
      // As linhas de continuação começam com um espaço, que conta no limite.
      limit = 74;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

function durationMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `PT${h ? `${h}H` : ''}${m || !h ? `${m}M` : ''}`;
}

/** O arquivo .ics completo (linhas terminadas em CRLF). */
export function buildIcs(calendar: IcsCalendar): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Nova Arena//Calendario de partidas//PT-BR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `NAME:${icsEscape(calendar.name)}`,
    `X-WR-CALNAME:${icsEscape(calendar.name)}`,
    ...(calendar.description ? [`X-WR-CALDESC:${icsEscape(calendar.description)}`] : []),
    ...(calendar.timeZone ? [`X-WR-TIMEZONE:${calendar.timeZone}`] : []),
    `REFRESH-INTERVAL;VALUE=DURATION:${durationMinutes(calendar.refreshMinutes ?? 60)}`,
    `X-PUBLISHED-TTL:${durationMinutes(calendar.refreshMinutes ?? 60)}`,
  ];
  const stamp = icsDateTime(calendar.now);
  for (const event of calendar.events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${icsEscape(event.uid)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsDateTime(event.start)}`,
      `DTEND:${icsDateTime(event.end)}`,
      `SUMMARY:${icsEscape(event.summary)}`,
      ...(event.description ? [`DESCRIPTION:${icsEscape(event.description)}`] : []),
      ...(event.url ? [`URL:${event.url}`] : []),
      `STATUS:${event.status ?? 'CONFIRMED'}`,
      ...(event.lastModified ? [`LAST-MODIFIED:${icsDateTime(event.lastModified)}`] : []),
    );
    const alarm = event.alarmMinutes === undefined ? 15 : event.alarmMinutes;
    if (alarm !== null && event.status !== 'CANCELLED') {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(event.summary)}`, `TRIGGER:-${durationMinutes(alarm)}`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(icsFold).join('\r\n')}\r\n`;
}

/** Duração estimada de uma partida no calendário: queda BR 30 min; duelo 10 min por jogo da série (mínimo 15). */
export function estimatedMatchMinutes(match: Pick<Match, 'kind' | 'bestOf'>): number {
  if (match.kind === 'LOBBY') return 30;
  return Math.max(15, 10 * (match.bestOf || 1));
}

/** Título da partida no calendário. */
export function calendarMatchTitle(match: Pick<Match, 'kind' | 'roundLabel' | 'stageName' | 'participants'>, tournamentName: string): string {
  if (match.kind === 'LOBBY') return `${tournamentName}: ${match.stageName} · ${match.roundLabel}`;
  const names = match.participants.map((p) => p.name || p.sourceLabel || 'A definir');
  return `${tournamentName}: ${match.roundLabel} · ${names.join(' x ')}`;
}

/** Partida com horário → evento do calendário. Partidas sem horário ficam de fora. */
export function matchToIcsEvent(
  match: Pick<Match, 'id' | 'kind' | 'bestOf' | 'roundLabel' | 'stageName' | 'participants' | 'scheduledAt' | 'status'>,
  tournament: { name: string; slug: string },
  opts: { siteUrl: string; domain?: string },
): IcsEvent | null {
  if (!match.scheduledAt) return null;
  const start = new Date(match.scheduledAt);
  const link = `${opts.siteUrl.replace(/\/$/, '')}/c/${tournament.slug}?aba=partidas`;
  return {
    uid: `partida-${match.id}@${opts.domain ?? 'novaarena.gg'}`,
    start,
    end: new Date(start.getTime() + estimatedMatchMinutes(match) * 60_000),
    summary: calendarMatchTitle(match, tournament.name),
    description: `Partida na Nova Arena. Check-in, sala e resultado: ${link}`,
    url: link,
    status: match.status === 'CANCELLED' ? 'CANCELLED' : 'CONFIRMED',
  };
}
