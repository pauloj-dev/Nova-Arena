/**
 * Opções do Sentry (issue #116), iguais no navegador e no servidor. Privacidade (LGPD): nada de PII por padrão
 * (`sendDefaultPii: false`), sem *session replay*, e o `beforeSend` tira cookies, cabeçalhos de autenticação e
 * corpos de requisição antes de qualquer envio.
 */
import type { ErrorEvent } from '@sentry/nextjs';

const SENSITIVE_HEADERS = new Set(['cookie', 'authorization', 'x-vercel-protection-bypass', 'upstash-signature']);

/** Remove dado sensível do evento (exportada para teste). */
export function scrubEvent<T extends Pick<ErrorEvent, 'request' | 'user'>>(event: T): T {
  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
    if (event.request.headers) {
      for (const key of Object.keys(event.request.headers)) if (SENSITIVE_HEADERS.has(key.toLowerCase())) delete event.request.headers[key];
    }
    // Tokens em query string (links de e-mail, convites) nunca saem.
    if (event.request.query_string) event.request.query_string = '[removido]';
  }
  // Só o id da conta, quando houver: nunca e-mail, IP ou apelido.
  if (event.user) event.user = event.user.id ? { id: event.user.id } : {};
  return event;
}

const common = (dsn: string) => ({
  dsn,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA,
  sendDefaultPii: false,
  // Os traces ficam com o OpenTelemetry da Vercel; o Sentry recebe os erros.
  tracesSampleRate: 0,
  beforeSend: (event: ErrorEvent) => scrubEvent(event),
});

export function sentryServerOptions(dsn: string) {
  return { ...common(dsn), enableOpenTelemetrySetup: false };
}

export function sentryClientOptions(dsn: string) {
  return common(dsn);
}
