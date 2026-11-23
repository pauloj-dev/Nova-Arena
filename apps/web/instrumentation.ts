/**
 * Observabilidade no servidor (issue #116, RNF-14). Roda uma vez por instância (Node e Edge), antes de qualquer rota.
 *
 * - **OpenTelemetry** com `@vercel/otel`: rastreamento distribuído das funções (o Next instrumenta rotas, `fetch` e
 *   renderização). Na Vercel os spans vão para o painel de Observability e, com um *trace drain*, para fora.
 * - **Sentry** (erros das funções, inclusive a API e os jobs, que relatam por `reportServerError`): só liga com
 *   `SENTRY_DSN`. Sem DSN nada é importado nem enviado. O Sentry não registra outro *tracer provider*
 *   (`enableOpenTelemetrySetup: false`): os spans ficam com o `@vercel/otel`, o Sentry fica com os erros.
 */
import { registerOTel } from '@vercel/otel';
import type { Instrumentation } from 'next';
import { sentryServerOptions } from './shared/observability/sentry-options';

export async function register() {
  registerOTel({ serviceName: 'nova-arena' });
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.init(sentryServerOptions(dsn));
}

/** Erros de renderização, rotas e Server Actions que o Next intercepta. */
export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.captureRequestError(...args);
};
