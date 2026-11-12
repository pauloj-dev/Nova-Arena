import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from '@/shared/api/client';

/**
 * Leva os erros por campo da API (`ApiError.fieldErrors`) para o formulário.
 * Devolve `true` se pelo menos um campo recebeu erro — aí não é preciso mostrar o erro geral.
 */
export function applyFieldErrors<T extends FieldValues>(error: unknown, setError: UseFormSetError<T>, fields: readonly Path<T>[]): boolean {
  if (!(error instanceof ApiError)) return false;
  let applied = false;
  for (const field of fields) {
    const message = error.fieldErrors[field];
    if (message) {
      setError(field, { type: 'server', message }, { shouldFocus: !applied });
      applied = true;
    }
  }
  return applied;
}

/** O erro da API aponta para algum destes campos? */
export function hasFieldErrors(error: unknown, fields: readonly string[]): boolean {
  return error instanceof ApiError && fields.some((field) => Boolean(error.fieldErrors[field]));
}
