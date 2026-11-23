/**
 * Envio de Web Push (issue #109) com VAPID, pela biblioteca `web-push` (criptografia `aes128gcm` da RFC 8291).
 * Sem as chaves VAPID (local, testes), só registra no log.
 */
import { sendNotification, WebPushError } from 'web-push';
import type { Env } from '../../env';
import type { Logger } from '../../logger';

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** `sent`: entregue ao serviço de push. `gone`: a assinatura não existe mais (apagar). Outros erros lançam. */
export type PushResult = 'sent' | 'gone';

export interface PushSender {
  readonly configured: boolean;
  send(target: PushTarget, payload: string): Promise<PushResult>;
}

/** Um dia: aviso de check-in que não chega em 24 h não serve mais. */
const TTL_SECONDS = 24 * 3600;

export function webPushSender(env: Env, log: Logger): PushSender {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey } = env;
  if (!publicKey || !privateKey) {
    return {
      configured: false,
      async send() {
        log.info('push não enviado (sem chaves VAPID neste ambiente)');
        return 'sent';
      },
    };
  }
  const subject = env.VAPID_SUBJECT ?? (env.NEXT_PUBLIC_SITE_URL?.startsWith('https://') ? env.NEXT_PUBLIC_SITE_URL : 'mailto:suporte@novaarena.gg');
  return {
    configured: true,
    async send(target, payload) {
      try {
        await sendNotification({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } }, payload, {
          vapidDetails: { subject, publicKey, privateKey },
          TTL: TTL_SECONDS,
          urgency: 'high',
        });
        return 'sent';
      } catch (error) {
        // 404/410: o navegador cancelou a assinatura (ou a pessoa limpou os dados do site).
        if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) return 'gone';
        throw error;
      }
    },
  };
}
