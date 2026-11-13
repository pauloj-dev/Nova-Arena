/**
 * Logs estruturados (uma linha JSON por evento), com o ID da requisição, para o Vercel Observability
 * e o log drain. Nunca registre senha, token, cookie, código de sala nem corpo de requisição.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  msg: string;
  requestId?: string;
  [key: string]: unknown;
}

export type LogSink = (entry: LogEntry) => void;

/** Padrão: JSON no stdout/stderr (a Vercel coleta os dois). */
export const consoleSink: LogSink = (entry) => {
  const line = JSON.stringify({ time: new Date().toISOString(), ...entry });
  if (entry.level === 'error' || entry.level === 'warn') console.error(line);
  else console.log(line);
};

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  child(data: Record<string, unknown>): Logger;
}

export function createLogger(sink: LogSink = consoleSink, base: Record<string, unknown> = {}): Logger {
  const write = (level: LogLevel) => (msg: string, data: Record<string, unknown> = {}) => sink({ level, msg, ...base, ...data });
  return {
    debug: write('debug'),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
    child: (data) => createLogger(sink, { ...base, ...data }),
  };
}

/** ID da requisição: o que veio da borda (`x-vercel-id`/`x-request-id`) ou um novo. */
export function requestIdFrom(headers: Headers): string {
  const incoming = headers.get('x-request-id') ?? headers.get('x-vercel-id');
  // Só aceita um ID "comportado": nada de injetar texto arbitrário nos logs.
  if (incoming && /^[\w:.-]{1,128}$/.test(incoming)) return incoming;
  return crypto.randomUUID();
}
