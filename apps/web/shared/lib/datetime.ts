/**
 * Datas do produto: guardadas em UTC (ISO 8601), exibidas no fuso da pessoa,
 * sempre com o fuso explícito (PRD §22, risco R8).
 */
const LOCALE = 'pt-BR';

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';
  } catch {
    return 'America/Sao_Paulo';
  }
}

/** Nome curto e humano do fuso, ex.: "horário de Brasília". */
export function timeZoneLabel(timeZone: string, at: Date = new Date()): string {
  const known: Record<string, string> = {
    'America/Sao_Paulo': 'horário de Brasília',
    'America/Manaus': 'horário de Manaus',
    'America/Cuiaba': 'horário de Cuiabá',
    'America/Rio_Branco': 'horário do Acre',
    'America/Noronha': 'horário de Fernando de Noronha',
    'America/Belem': 'horário de Brasília',
    'America/Fortaleza': 'horário de Brasília',
    'America/Recife': 'horário de Brasília',
    'America/Bahia': 'horário de Brasília',
    'Europe/Lisbon': 'horário de Lisboa',
    UTC: 'UTC',
  };
  if (known[timeZone]) return known[timeZone];
  const part = new Intl.DateTimeFormat(LOCALE, { timeZone, timeZoneName: 'shortOffset' }).formatToParts(at).find((p) => p.type === 'timeZoneName');
  return part?.value ?? timeZone;
}

export interface FormatOptions {
  timeZone?: string;
  /** Mostra o fuso depois da hora. Padrão: sim. */
  withZone?: boolean;
}

function tz(opts?: FormatOptions): string {
  return opts?.timeZone ?? browserTimeZone();
}

/** "12/11/2026" */
export function formatDate(iso: string, opts?: FormatOptions): string {
  return new Intl.DateTimeFormat(LOCALE, { timeZone: tz(opts), day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));
}

/** "20h" ou "20h30" */
export function formatTime(iso: string, opts?: FormatOptions): string {
  const parts = new Intl.DateTimeFormat(LOCALE, { timeZone: tz(opts), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`;
}

/** "sáb., 14/11 · 20h · horário de Brasília" */
export function formatDateTime(iso: string, opts?: FormatOptions): string {
  const zone = tz(opts);
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat(LOCALE, { timeZone: zone, weekday: 'short', day: '2-digit', month: '2-digit' }).format(d);
  const base = `${day} · ${formatTime(iso, { timeZone: zone })}`;
  return opts?.withZone === false ? base : `${base} · ${timeZoneLabel(zone, d)}`;
}

/** "em 15 min", "há 2 h", "amanhã" */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const diffSec = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(diffSec, 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diffSec / 86400), 'day');
  return rtf.format(Math.round(diffSec / (86400 * 30)), 'month');
}

/** Deslocamento (em minutos) do fuso em relação ao UTC naquele instante. Leva em conta horário de verão. */
function offsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - at.getTime()) / 60000);
}

/**
 * Converte o valor de um <input type="datetime-local"> ("2026-11-14T20:00"),
 * digitado no fuso informado, para ISO em UTC.
 */
export function localInputToIso(value: string, timeZone: string = browserTimeZone()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) throw new Error('Data inválida');
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  // Duas passadas: a segunda corrige o caso em que o chute cai do outro lado de uma virada de horário de verão.
  let utc = guess - offsetMinutes(timeZone, new Date(guess)) * 60000;
  utc = guess - offsetMinutes(timeZone, new Date(utc)) * 60000;
  return new Date(utc).toISOString();
}

/** Inverso de `localInputToIso`: ISO em UTC → valor para <input type="datetime-local"> no fuso informado. */
export function isoToLocalInput(iso: string, timeZone: string = browserTimeZone()): string {
  const d = new Date(iso);
  const local = new Date(d.getTime() + offsetMinutes(timeZone, d) * 60000);
  return local.toISOString().slice(0, 16);
}
