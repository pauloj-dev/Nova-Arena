/**
 * Envio de e-mail. A implementação com o Resend (templates, domínio autenticado) entra com a issue #80;
 * até lá, o carteiro padrão só registra no log que o e-mail seria enviado (nunca o link: ele vale uma conta).
 */
import type { Logger } from './logger';

export type MailTemplate = 'VERIFY_EMAIL' | 'RESET_PASSWORD';

export interface MailMessage {
  to: string;
  template: MailTemplate;
  /** Dados do template (ex.: `{ nickname, link }`). */
  data: Record<string, string>;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export function logMailer(log: Logger): Mailer {
  return {
    async send(message) {
      log.info('e-mail (sem envio real até a issue #80)', { template: message.template, toDomain: message.to.split('@')[1] ?? '' });
    },
  };
}
