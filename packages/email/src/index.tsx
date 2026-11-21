/**
 * E-mails transacionais (issue #80): templates em React Email com a identidade Nova Green e uma camada
 * de envio única com o Resend.
 *
 * Modos (`createMailer`):
 * - **produção** (`VERCEL_ENV=production`): envia de verdade; exige `RESEND_API_KEY` e `EMAIL_FROM`.
 * - **preview e local**: com `RESEND_API_KEY` e `EMAIL_TEST_INBOX`, tudo vai para a caixa de teste (o
 *   destinatário original aparece no assunto); sem eles, só registra no log que o e-mail seria enviado.
 */
import { render } from '@react-email/render';
import type { ReactElement } from 'react';
import { messages } from './messages.pt-BR';
import { ConfirmEmailChange, EmailChanged, NotificationEmail, PasswordChanged, ResetPassword, RoleInvite, TeamInvite, VerifyEmail, type NotificationEmailProps } from './templates';

export { EMAIL_THEME, THEME_SOURCE } from './theme';
export { messages } from './messages.pt-BR';

export type EmailMessage =
  | { template: 'VERIFY_EMAIL'; data: { nickname: string; link: string } }
  | { template: 'RESET_PASSWORD'; data: { nickname: string; link: string } }
  | { template: 'ROLE_INVITE'; data: { role: string; inviter: string; link: string; expiresAt: string } }
  | { template: 'TEAM_INVITE'; data: { team: string; captain: string; link: string } }
  | { template: 'CONFIRM_EMAIL_CHANGE'; data: { nickname: string; link: string } }
  | { template: 'EMAIL_CHANGED'; data: { nickname: string; newEmail: string; link: string } }
  | { template: 'PASSWORD_CHANGED'; data: { nickname: string; link: string } }
  /** Aviso da plataforma (notificação por e-mail, issue #98): um texto por tipo em `messages.NOTIFICATION`. */
  | { template: 'NOTIFICATION'; data: NotificationEmailProps };

export type EmailTemplate = EmailMessage['template'];

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function build(message: EmailMessage): { subject: string; element: ReactElement } {
  switch (message.template) {
    case 'VERIFY_EMAIL':
      return { subject: messages.VERIFY_EMAIL.subject, element: <VerifyEmail {...message.data} /> };
    case 'RESET_PASSWORD':
      return { subject: messages.RESET_PASSWORD.subject, element: <ResetPassword {...message.data} /> };
    case 'ROLE_INVITE':
      return { subject: messages.ROLE_INVITE.subject(messages.ROLE_INVITE.roles[message.data.role] ?? message.data.role), element: <RoleInvite {...message.data} /> };
    case 'TEAM_INVITE':
      return { subject: messages.TEAM_INVITE.subject(message.data.team), element: <TeamInvite {...message.data} /> };
    case 'CONFIRM_EMAIL_CHANGE':
      return { subject: messages.CONFIRM_EMAIL_CHANGE.subject, element: <ConfirmEmailChange {...message.data} /> };
    case 'EMAIL_CHANGED':
      return { subject: messages.EMAIL_CHANGED.subject, element: <EmailChanged {...message.data} /> };
    case 'PASSWORD_CHANGED':
      return { subject: messages.PASSWORD_CHANGED.subject, element: <PasswordChanged {...message.data} /> };
    case 'NOTIFICATION': {
      const kind = messages.NOTIFICATION.types[message.data.type] ?? messages.NOTIFICATION.fallback;
      return { subject: messages.NOTIFICATION.subject(kind.kicker, message.data.title), element: <NotificationEmail {...message.data} /> };
    }
  }
}

/** HTML (com estilos em linha) e a versão em texto puro, que ajuda a não cair no spam. */
export async function renderEmail(message: EmailMessage): Promise<RenderedEmail> {
  const { subject, element } = build(message);
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject, html, text };
}

// ── Envio ────────────────────────────────────────────────────────────

export interface OutgoingEmail extends RenderedEmail {
  to: string;
  /** Evita e-mail duplicado quando a mesma mensagem é reenviada (ex.: nova tentativa de um job). */
  idempotencyKey?: string;
}

export interface EmailSender {
  send(email: OutgoingEmail): Promise<void>;
}

export class EmailError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'EmailError';
  }
}

/** Resend pela API REST (https://resend.com/docs/api-reference/emails/send-email). */
export function resendSender(options: { apiKey: string; from: string; fetch?: typeof fetch }): EmailSender {
  const doFetch = options.fetch ?? fetch;
  return {
    async send(email) {
      const headers: Record<string, string> = { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' };
      if (email.idempotencyKey) headers['Idempotency-Key'] = email.idempotencyKey;
      const res = await doFetch('https://api.resend.com/emails', {
        method: 'POST',
        headers,
        body: JSON.stringify({ from: options.from, to: [email.to], subject: email.subject, html: email.html, text: email.text }),
      });
      if (!res.ok) throw new EmailError(`O Resend recusou o envio (HTTP ${res.status}).`, res.status);
    },
  };
}

export interface MailerConfig {
  production: boolean;
  apiKey?: string;
  from?: string;
  /** Caixa que recebe todos os e-mails fora de produção. */
  testInbox?: string;
  fetch?: typeof fetch;
  /** Para o modo "só log": nunca recebe o link (ele vale uma conta). */
  log: (msg: string, data: Record<string, unknown>) => void;
}

export interface Mailer {
  readonly mode: 'resend' | 'test-inbox' | 'log';
  send(to: string, message: EmailMessage, options?: { idempotencyKey?: string }): Promise<void>;
}

export function createMailer(config: MailerConfig): Mailer {
  if (config.production) {
    if (!config.apiKey || !config.from) throw new EmailError('Em produção, configure RESEND_API_KEY e EMAIL_FROM.');
    const sender = resendSender({ apiKey: config.apiKey, from: config.from, fetch: config.fetch });
    return {
      mode: 'resend',
      async send(to, message, options) {
        await sender.send({ to, ...(await renderEmail(message)), idempotencyKey: options?.idempotencyKey });
      },
    };
  }
  if (config.apiKey && config.testInbox) {
    const sender = resendSender({ apiKey: config.apiKey, from: config.from ?? 'Nova Arena <onboarding@resend.dev>', fetch: config.fetch });
    const inbox = config.testInbox;
    return {
      mode: 'test-inbox',
      async send(to, message, options) {
        const rendered = await renderEmail(message);
        await sender.send({ ...rendered, to: inbox, subject: `[teste para ${to}] ${rendered.subject}`, idempotencyKey: options?.idempotencyKey });
      },
    };
  }
  return {
    mode: 'log',
    async send(to, message) {
      config.log('e-mail não enviado (sem Resend neste ambiente)', { template: message.template, toDomain: to.split('@')[1] ?? '' });
    },
  };
}
