/**
 * Validação de modelo de pontuação. Quem decide o que é válido é o motor (`@nova/engine`);
 * aqui só ligamos cada mensagem dele à regra ou ao campo certo da tela e da API.
 */
import { validateScoringModel } from '@nova/engine';
import type { ScoringDraft } from './types';

/** Mensagens do motor para o modelo em edição. Lista vazia = pode salvar. */
export function validateDraft(draft: ScoringDraft): string[] {
  return validateScoringModel({
    // O motor também confere identificador e jogo, que o rascunho ainda não tem.
    id: 'rascunho',
    gameSlug: 'rascunho',
    name: draft.name,
    matchType: draft.matchType,
    rules: draft.rules,
    tiebreakers: draft.tiebreakers,
  });
}

export const NAME_ERROR = 'Informe o nome do modelo.';

const RULE_PREFIX = /^Regra (\d+):\s*(.*)$/;

export interface GroupedErrors {
  /** Mensagem do campo de nome, se houver. */
  name: string | null;
  /** Mensagens por índice de regra (base 0), já sem o prefixo "Regra N:". */
  byRule: Record<number, string[]>;
  /** Mensagens sobre os critérios de desempate. */
  tiebreakers: string[];
  /** O que sobra: vale para o modelo inteiro. */
  general: string[];
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Separa as mensagens do motor por lugar da tela. Mensagens repetidas contam uma vez só. */
export function groupErrors(errors: readonly string[]): GroupedErrors {
  const grouped: GroupedErrors = { name: null, byRule: {}, tiebreakers: [], general: [] };
  for (const message of new Set(errors)) {
    const match = RULE_PREFIX.exec(message);
    if (match) {
      const index = Number(match[1]) - 1;
      (grouped.byRule[index] ??= []).push(capitalize(match[2] ?? ''));
    } else if (message === NAME_ERROR) {
      grouped.name = message;
    } else if (/desempate/i.test(message)) {
      grouped.tiebreakers.push(message);
    } else {
      grouped.general.push(message);
    }
  }
  return grouped;
}

/** Mensagens do motor → erros por campo da API (`rules.0`, `name`, `tiebreakers`, `rules`). */
export function toFieldErrors(errors: readonly string[]): Record<string, string> {
  const grouped = groupErrors(errors);
  const fields: Record<string, string> = {};
  if (grouped.name) fields.name = grouped.name;
  for (const [index, messages] of Object.entries(grouped.byRule)) {
    if (messages[0]) fields[`rules.${index}`] = messages[0];
  }
  if (grouped.tiebreakers[0]) fields.tiebreakers = grouped.tiebreakers[0];
  if (grouped.general[0]) fields.rules = grouped.general[0];
  return fields;
}

/** Caminho inverso: erros por campo devolvidos pela API → mensagens que o editor sabe posicionar. */
export function fieldErrorsToMessages(fieldErrors: Record<string, string>): string[] {
  return Object.entries(fieldErrors).map(([key, message]) => {
    const rule = /^rules\.(\d+)(?:\.|$)/.exec(key);
    if (rule) return `Regra ${Number(rule[1]) + 1}: ${message.charAt(0).toLowerCase()}${message.slice(1)}`;
    if (key === 'name') return NAME_ERROR;
    return message;
  });
}
