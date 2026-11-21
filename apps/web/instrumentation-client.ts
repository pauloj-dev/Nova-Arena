/**
 * Roda no navegador antes da hidratação.
 *
 * - Proteção contra bots (issue #69): o Vercel BotID assina as requisições do cadastro e da recuperação de senha, e a
 *   API confere (`packages/api/src/auth/bot.ts`). Em desenvolvimento o BotID não faz nada.
 * - Erros do navegador no Sentry (issue #116): só com `NEXT_PUBLIC_SENTRY_DSN`, e carregado depois (import dinâmico),
 *   fora do JS inicial das páginas (#111). Sem DSN nada é baixado.
 */
import { initBotId } from 'botid/client/core';
import { sentryClientOptions } from './shared/observability/sentry-options';

initBotId({
  protect: [
    { path: '/api/v1/auth/register', method: 'POST' },
    { path: '/api/v1/auth/forgot-password', method: 'POST' },
  ],
});

const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (sentryDsn) {
  void import('@sentry/nextjs').then((Sentry) => Sentry.init(sentryClientOptions(sentryDsn)));
}
