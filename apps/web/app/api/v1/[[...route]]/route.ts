/**
 * API real (Hono, `packages/api`) montada no Next.js como Vercel Function (Node.js, região `gru1`).
 * No navegador, os módulos ainda simulados (`NEXT_PUBLIC_API_MOCK`) são atendidos pelo MSW antes de
 * chegar aqui; o que não é simulado cai nesta rota.
 *
 * Quando um campeonato ou perfil muda, a API avisa as páginas públicas em cache (ISR, issue #77): a próxima
 * visita já vem com os dados novos (`expire: 0` = sem servir a versão antiga).
 *
 * Erros 500 da API e dos jobs (QStash e Cron) vão para o Sentry quando há `SENTRY_DSN` (issue #116): o Hono trata o
 * erro antes de o Next ver, então quem relata é a própria API (`reportError`).
 */
import { createRouteHandler } from '@nova/api';
import { revalidateTag } from 'next/cache';

function reportError(error: unknown, context: Record<string, string | number | null>): void {
  if (!process.env.SENTRY_DSN) return;
  void import('@sentry/nextjs').then((Sentry) => Sentry.captureException(error, { tags: { area: 'job' in context ? 'job' : 'api' }, extra: context })).catch(() => undefined);
}

const handler = createRouteHandler({ deps: { revalidate: (tags) => tags.forEach((tag) => revalidateTag(tag, { expire: 0 })), reportError } });

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
