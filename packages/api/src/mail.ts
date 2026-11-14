/**
 * Envio de e-mail da API: a camada única de `@nova/email` (templates em React Email + Resend).
 * Produção envia de verdade; preview e local mandam para `EMAIL_TEST_INBOX` ou só registram no log.
 */
import { createMailer, type Mailer } from '@nova/email';
import type { Env } from './env';
import type { Logger } from './logger';

export type { EmailMessage, Mailer } from '@nova/email';

export function defaultMailer(env: Env, log: Logger): Mailer {
  return createMailer({
    production: env.VERCEL_ENV === 'production',
    apiKey: env.RESEND_API_KEY,
    from: env.EMAIL_FROM,
    testInbox: env.EMAIL_TEST_INBOX,
    log: (msg, data) => log.info(msg, data),
  });
}
