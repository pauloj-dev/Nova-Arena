/**
 * Força da senha mostrada no cadastro e na redefinição. É só orientação para a pessoa:
 * a regra que vale (mínimo de 8 caracteres, letra e número) está no schema `Password`.
 */
export type PasswordStrengthLabel = 'fraca' | 'razoável' | 'boa' | 'forte';

export interface PasswordStrength {
  /** 0 = campo vazio; 1 a 4 = fraca, razoável, boa, forte. */
  score: 0 | 1 | 2 | 3 | 4;
  label: PasswordStrengthLabel | null;
  /** O que fazer para melhorar. Nulo quando já está forte ou o campo está vazio. */
  tip: string | null;
}

const LABELS: Record<1 | 2 | 3 | 4, PasswordStrengthLabel> = { 1: 'fraca', 2: 'razoável', 3: 'boa', 4: 'forte' };

/** Senhas que aparecem em qualquer lista de vazamento, mais as óbvias para este produto. */
const COMMON = ['12345678', '123456789', '1234567890', 'password', 'password1', 'senha123', 'senha1234', 'qwerty123', 'abc12345', 'novaarena', 'freefire', 'freefire123', 'iloveyou1'];

function variety(password: string): number {
  return [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
}

/** "aaaaaaaa", "abababab": poucos caracteres diferentes para o tamanho. */
function isRepetitive(password: string): boolean {
  return new Set(password.toLowerCase()).size <= Math.max(2, Math.floor(password.length / 4));
}

export function passwordStrength(password: string): PasswordStrength {
  if (password.length === 0) return { score: 0, label: null, tip: null };

  const kinds = variety(password);
  const length = password.length;
  let score: 1 | 2 | 3 | 4 = 1;
  let tip: string | null;

  if (length < 8) {
    tip = 'Use pelo menos 8 caracteres.';
  } else if (COMMON.includes(password.toLowerCase()) || isRepetitive(password)) {
    tip = 'Essa senha é fácil de adivinhar. Evite sequências e repetições.';
  } else if (kinds < 2) {
    tip = 'Misture letras e números.';
  } else if ((kinds >= 4 && length >= 12) || (kinds >= 3 && length >= 14)) {
    score = 4;
    tip = null;
  } else if ((kinds >= 3 && length >= 10) || length >= 12) {
    score = 3;
    tip = 'Para ficar forte, use 12 caracteres ou mais com maiúsculas, números e símbolos.';
  } else {
    score = 2;
    tip = 'Deixe a senha mais longa ou acrescente maiúsculas e símbolos.';
  }

  return { score, label: LABELS[score], tip };
}
