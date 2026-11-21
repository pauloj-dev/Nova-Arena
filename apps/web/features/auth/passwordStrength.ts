/**
 * Força da senha mostrada no cadastro e na redefinição. É só orientação para a pessoa:
 * a regra que vale (mínimo de 8 caracteres, letra e número) está no schema `Password`.
 */
import { weakPasswordReason } from '@nova/schemas';
import { getT } from '@/shared/i18n/core';
import { messages } from './messages';

export interface PasswordStrength {
  /** 0 = campo vazio; 1 a 4 = fraca, razoável, boa, forte. */
  score: 0 | 1 | 2 | 3 | 4;
  /** "fraca", "razoável", "boa" ou "forte" (no idioma da página). */
  label: string | null;
  /** O que fazer para melhorar. Nulo quando já está forte ou o campo está vazio. */
  tip: string | null;
}

const LABELS = { 1: 'fraca', 2: 'razoavel', 3: 'boa', 4: 'forte' } as const;

function variety(password: string): number {
  return [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
}

/** "aaaaaaaa", "abababab": poucos caracteres diferentes para o tamanho. */
function isRepetitive(password: string): boolean {
  return new Set(password.toLowerCase()).size <= Math.max(2, Math.floor(password.length / 4));
}

export function passwordStrength(password: string): PasswordStrength {
  if (password.length === 0) return { score: 0, label: null, tip: null };
  const t = getT(messages, 'passwordStrength');

  const kinds = variety(password);
  const length = password.length;
  let score: 1 | 2 | 3 | 4 = 1;
  let tip: string | null;

  if (length < 8) {
    tip = t('dicaCurta');
  } else if (weakPasswordReason(password) !== null || isRepetitive(password)) {
    tip = t('dicaFacil');
  } else if (kinds < 2) {
    tip = t('dicaMisture');
  } else if ((kinds >= 4 && length >= 12) || (kinds >= 3 && length >= 14)) {
    score = 4;
    tip = null;
  } else if ((kinds >= 3 && length >= 10) || length >= 12) {
    score = 3;
    tip = t('dicaBoa');
  } else {
    score = 2;
    tip = t('dicaRazoavel');
  }

  return { score, label: t(`rotulo.${LABELS[score]}`), tip };
}
