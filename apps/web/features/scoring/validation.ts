/**
 * Validação de modelo de pontuação. Quem decide o que é válido é o motor (`@nova/engine`), que também liga
 * cada mensagem ao campo certo (`scoringFieldErrors`): a mesma regra na tela, no mock e na API real (#74).
 */
import { groupScoringErrors, SCORING_NAME_ERROR, scoringFieldErrors, validateScoringDraft, type GroupedScoringErrors } from '@nova/engine';
import { getT } from '@/shared/i18n/core';
import { messages } from './messages';
import type { ScoringDraft } from './types';

/** Mensagens do motor para o modelo em edição. Lista vazia = pode salvar. */
export const validateDraft = (draft: ScoringDraft): string[] => validateScoringDraft(draft);
export const NAME_ERROR = SCORING_NAME_ERROR;
export type GroupedErrors = GroupedScoringErrors;
export const groupErrors = groupScoringErrors;
/** Mensagens do motor → erros por campo da API (`rules.0`, `name`, `tiebreakers`, `rules`). */
export const toFieldErrors = scoringFieldErrors;

/** Caminho inverso: erros por campo devolvidos pela API → mensagens que o editor sabe posicionar. */
export function fieldErrorsToMessages(fieldErrors: Record<string, string>): string[] {
  const t = getT(messages, 'validation');
  return Object.entries(fieldErrors).map(([key, message]) => {
    const rule = /^rules\.(\d+)(?:\.|$)/.exec(key);
    if (rule) return t('erroNaRegra', { numero: Number(rule[1]) + 1, mensagem: `${message.charAt(0).toLowerCase()}${message.slice(1)}` });
    if (key === 'name') return NAME_ERROR;
    return message;
  });
}
