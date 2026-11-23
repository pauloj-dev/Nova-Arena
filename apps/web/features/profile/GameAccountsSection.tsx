'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { Game, GameAccount, Me } from '@nova/schemas';
import { Badge, Button, EmptyState, ErrorState, Input, Skeleton, useToast } from '@nova/ui';
import { CheckCircle2, CircleDashed, Gamepad2 } from 'lucide-react';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useGames } from '@/shared/api/hooks/games';
import { useDeleteGameAccount, useUpsertGameAccount } from '@/shared/api/hooks/users';
import { useT } from '@/shared/i18n/react';
import { messages } from './messages';
import { gameAccountDefaults, gameAccountSchema } from './profileLib';

interface AccountValues {
  fields: Record<string, string>;
}

/** ID só de números (ex.: `^[0-9]{6,12}$` do Free Fire): abre o teclado numérico no celular. */
function onlyDigits(pattern: string | null | undefined): boolean {
  return Boolean(pattern) && /^\^?(\[0-9\]|\\d)(\{\d+(,\d*)?\}|[+*])?\$?$/.test(pattern ?? '');
}

function GameAccountForm({ game, account }: { game: Game; account: GameAccount | undefined }) {
  const t = useT(messages, 'GameAccountsSection');
  const { success, error } = useToast();
  const upsert = useUpsertGameAccount();
  const remove = useDeleteGameAccount();
  const schema = useMemo(() => gameAccountSchema(game.requiredAccountFields), [game.requiredAccountFields]);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors },
  } = useForm<AccountValues>({ resolver: zodResolver(schema), defaultValues: { fields: gameAccountDefaults(game.requiredAccountFields, account?.fields) } });

  function showError(title: string, e: unknown) {
    let onField = false;
    if (e instanceof ApiError) {
      for (const [key, message] of Object.entries(e.fieldErrors)) {
        // A API devolve os erros como `fields.<chave>`, igual ao caminho do formulário.
        const fieldKey = key.startsWith('fields.') ? key.slice('fields.'.length) : null;
        if (!fieldKey || !game.requiredAccountFields.some((f) => f.key === fieldKey)) continue;
        setError(`fields.${fieldKey}`, { type: 'server', message }, { shouldFocus: !onField });
        onField = true;
      }
    }
    error(title, onField ? t('confiraCampos') : errorMessage(e));
  }

  const onSubmit = handleSubmit((values) => {
    upsert.mutate(
      { gameId: game.id, fields: values.fields },
      {
        onSuccess: (me) => {
          reset({ fields: gameAccountDefaults(game.requiredAccountFields, me.gameAccounts.find((a) => a.gameId === game.id)?.fields) });
          success(t('salvo', { jogo: game.name }));
        },
        onError: (e) => showError(t('erroSalvar', { jogo: game.name }), e),
      },
    );
  });

  function onRemove() {
    remove.mutate(game.id, {
      onSuccess: () => {
        reset({ fields: gameAccountDefaults(game.requiredAccountFields, undefined) });
        success(t('removido', { jogo: game.name }));
      },
      onError: (e) => showError(t('erroRemover', { jogo: game.name }), e),
    });
  }

  return (
    <li className="rounded-lg border border-border bg-surface p-4">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex min-w-0 items-center gap-2 text-base">
            <span aria-hidden>{game.icon}</span>
            {game.name}
          </h3>
          {account ? (
            <Badge tone="primary" icon={<CheckCircle2 className="size-3.5" aria-hidden />}>
              {t('informado')}
            </Badge>
          ) : (
            <Badge tone="neutral" icon={<CircleDashed className="size-3.5" aria-hidden />}>
              {t('naoInformado')}
            </Badge>
          )}
        </div>
        {game.requiredAccountFields.length === 0 ? (
          <p className="text-sm text-muted">{t('semId')}</p>
        ) : (
          <>
            <div className="grid gap-3 xs:grid-cols-2">
              {game.requiredAccountFields.map((field) => (
                <Input key={field.key} label={field.label} placeholder={field.placeholder} inputMode={onlyDigits(field.pattern) ? 'numeric' : undefined} autoComplete="off" autoCapitalize="off" spellCheck={false} error={errors.fields?.[field.key]?.message} {...register(`fields.${field.key}`)} />
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" loading={upsert.isPending} aria-label={t('salvarRotulo', { jogo: game.name })}>
                {t('salvar')}
              </Button>
              {account && (
                <Button variant="ghost" size="sm" loading={remove.isPending} onClick={onRemove} aria-label={t('removerRotulo', { jogo: game.name })}>
                  {t('remover')}
                </Button>
              )}
            </div>
          </>
        )}
      </form>
    </li>
  );
}

/** IDs/nicks por jogo: um mini-formulário para cada jogo ativo, com os campos que o jogo exige. */
export function GameAccountsSection({ user }: { user: Me }) {
  const games = useGames();
  const t = useT(messages, 'GameAccountsSection');

  if (games.isPending) {
    return (
      <div className="flex flex-col gap-3" role="status" aria-label={t('carregando')}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-9 w-24" />
          </div>
        ))}
      </div>
    );
  }
  if (games.isError) {
    return <ErrorState title={t('erroCarregar')} description={errorMessage(games.error)} onRetry={() => void games.refetch()} />;
  }
  if (games.data.length === 0) {
    return <EmptyState icon={<Gamepad2 className="size-7" />} title={t('vazioTitulo')} description={t('vazioDescricao')} />;
  }
  return (
    <ul className="flex flex-col gap-3">
      {games.data.map((game) => (
        <GameAccountForm key={game.id} game={game} account={user.gameAccounts.find((a) => a.gameId === game.id)} />
      ))}
    </ul>
  );
}
