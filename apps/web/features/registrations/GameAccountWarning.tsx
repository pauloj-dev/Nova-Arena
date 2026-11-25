'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { AccountField } from '@nova/schemas';
import { Button, Input, useToast } from '@nova/ui';
import { useQueryClient } from '@tanstack/react-query';
import { IdCard } from 'lucide-react';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useGame } from '@/shared/api/hooks/games';
import { useUpsertGameAccount } from '@/shared/api/hooks/users';
import { useT } from '@/shared/i18n/react';
import { gameAccountDefaults, gameAccountSchema } from '../profile/profileLib';
import { messages } from './messages';

interface AccountValues {
  fields: Record<string, string>;
}

/** ID só de números (ex.: `^[0-9]{6,12}$` do Free Fire): abre o teclado numérico no celular. */
function onlyDigits(pattern: string | null | undefined): boolean {
  return Boolean(pattern) && /^\^?(\[0-9\]|\\d)(\{\d+(,\d*)?\}|[+*])?\$?$/.test(pattern ?? '');
}

/**
 * Falta o ID do jogo: o jogador informa ali mesmo, sem sair da página do campeonato, e segue para a inscrição
 * (ou para a confirmação no squad). Antes, o botão levava para Minha conta e a pessoa precisava achar o caminho de volta.
 */
export function GameAccountWarning({ gameId, gameName, context }: { gameId: string; gameName: string; context: 'register' | 'confirm' }) {
  const t = useT(messages, 'GameAccountWarning');
  const game = useGame(gameId);
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-md border border-warning bg-warning-soft p-3 text-warning-soft-text">
      <p className="flex items-start gap-2 text-sm">
        <IdCard className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          <strong>{t('faltaId', { jogo: gameName })}</strong> {context === 'register' ? t('paraInscrever') : t('paraConfirmar')}
        </span>
      </p>
      {game.data && game.data.requiredAccountFields.length > 0 && <AccountForm gameId={gameId} gameName={gameName} fields={game.data.requiredAccountFields} context={context} />}
    </div>
  );
}

function AccountForm({ gameId, gameName, fields, context }: { gameId: string; gameName: string; fields: AccountField[]; context: 'register' | 'confirm' }) {
  const t = useT(messages, 'GameAccountWarning');
  const { success, error } = useToast();
  const qc = useQueryClient();
  const upsert = useUpsertGameAccount();
  const schema = useMemo(() => gameAccountSchema(fields), [fields]);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<AccountValues>({ resolver: zodResolver(schema), defaultValues: { fields: gameAccountDefaults(fields, undefined) } });

  const onSubmit = handleSubmit((values) => {
    upsert.mutate(
      { gameId, fields: values.fields },
      {
        onSuccess: () => {
          // A inscrição e o elenco dizem quem já tem o ID: buscam de novo para liberar o botão.
          void qc.invalidateQueries({ queryKey: ['tournaments', 'registrations'] });
          success(t('salvo', { jogo: gameName }), context === 'register' ? t('agoraInscreva') : t('agoraConfirme'));
        },
        onError: (e) => {
          let onField = false;
          if (e instanceof ApiError) {
            for (const [key, message] of Object.entries(e.fieldErrors)) {
              const fieldKey = key.startsWith('fields.') ? key.slice('fields.'.length) : null;
              if (!fieldKey || !fields.some((f) => f.key === fieldKey)) continue;
              setError(`fields.${fieldKey}`, { type: 'server', message }, { shouldFocus: !onField });
              onField = true;
            }
          }
          error(t('erroSalvar', { jogo: gameName }), onField ? t('confiraCampos') : errorMessage(e));
        },
      },
    );
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3 rounded-md bg-surface p-3 text-text">
      <div className="grid gap-3 xs:grid-cols-2">
        {fields.map((field) => (
          <Input key={field.key} label={field.label} placeholder={field.placeholder} inputMode={onlyDigits(field.pattern) ? 'numeric' : undefined} autoComplete="off" autoCapitalize="off" spellCheck={false} error={errors.fields?.[field.key]?.message} {...register(`fields.${field.key}`)} />
        ))}
      </div>
      <Button type="submit" size="sm" className="self-start" loading={upsert.isPending}>
        {t('salvar', { jogo: gameName })}
      </Button>
      <p className="text-xs text-muted">{t('ondeMudar')}</p>
    </form>
  );
}
