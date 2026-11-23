import { getT } from '@/shared/i18n/core';
import { messages } from './messages';

/** Códigos de `?erro=` quando o login social volta sem sucesso (códigos da API, issue #68). */
const CODES = ['oauth_cancelado', 'oauth_estado', 'oauth_falhou', 'oauth_indisponivel', 'oauth_sem_email', 'oauth_email_existente', 'sessao_expirada', 'conta_banida', 'conta_suspensa'] as const;
type OAuthErrorCode = (typeof CODES)[number];

function isKnown(code: string): code is OAuthErrorCode {
  return (CODES as readonly string[]).includes(code);
}

/** Mensagem para `?erro=` quando o login social volta sem sucesso. */
export function oauthErrorMessage(code: string | null): string | null {
  if (!code) return null;
  const t = getT(messages, 'oauthErrors');
  return isKnown(code) ? t(code) : t('generico');
}
