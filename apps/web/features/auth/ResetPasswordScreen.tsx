'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ResetPasswordInput } from '@nova/schemas';
import { Button, Input } from '@nova/ui';
import { CircleCheck, CircleX } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { errorMessage } from '@/shared/api/client';
import { useResetPassword } from '@/shared/api/hooks/users';
import { getT } from '@/shared/i18n/core';
import { useT } from '@/shared/i18n/react';
import { AuthHeader, FormAlert } from './AuthParts';
import { applyFieldErrors, hasFieldErrors } from './formErrors';
import { messages } from './messages';
import { PasswordStrengthMeter } from './PasswordStrengthMeter';

/** A mesma regra de senha da API, mais a confirmação (que não sai do navegador). */
function resetFormSchema() {
  const t = getT(messages, 'ResetPasswordScreen');
  return ResetPasswordInput.pick({ password: true })
    .extend({ confirm: z.string().min(1, t('repitaSenha')) })
    .refine((v) => v.password === v.confirm, { path: ['confirm'], message: t('senhasDiferentes') });
}
type ResetForm = z.infer<ReturnType<typeof resetFormSchema>>;

/** `/redefinir-senha?token=...`: cria a nova senha a partir do link do e-mail. */
export function ResetPasswordScreen() {
  const t = useT(messages, 'ResetPasswordScreen');
  const token = useSearchParams().get('token');
  const reset = useResetPassword();
  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors },
  } = useForm<ResetForm>({ resolver: zodResolver(resetFormSchema()), mode: 'onTouched', defaultValues: { password: '', confirm: '' } });
  const password = useWatch({ control, name: 'password' }) ?? '';
  const passwordField = register('password');
  const confirmField = register('confirm');

  if (!token) {
    return (
      <div className="flex flex-col gap-5">
        <AuthHeader
          icon={<CircleX className="size-6" />}
          title={t('incompletoTitulo')}
          description={t('incompletoDescricao')}
        />
        <Button asChild fullWidth>
          <Link href="/recuperar-senha">{t('pedirNovo')}</Link>
        </Button>
      </div>
    );
  }

  if (reset.isSuccess) {
    return (
      <div className="flex flex-col gap-5">
        <AuthHeader icon={<CircleCheck className="size-6" />} title={t('alteradaTitulo')} description={t('alteradaDescricao')} />
        <Button asChild fullWidth>
          <Link href="/entrar">{t('entrar')}</Link>
        </Button>
      </div>
    );
  }

  const generalError = reset.isError && !hasFieldErrors(reset.error, ['password']) ? errorMessage(reset.error) : null;

  return (
    <div className="flex flex-col gap-5">
      <AuthHeader title={t('titulo')} description={t('descricao')} />
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={handleSubmit(({ password: newPassword }) =>
          reset.mutate(
            { token, password: newPassword },
            {
              onError: (e) => {
                applyFieldErrors(e, setError, ['password']);
              },
            },
          ),
        )}
      >
        {generalError && (
          <FormAlert>
            {generalError}{' '}
            <Link href="/recuperar-senha" className="font-semibold underline underline-offset-2">
              {t('pedirNovo')}
            </Link>
          </FormAlert>
        )}
        <div className="flex flex-col gap-1.5">
          <Input label={t('novaSenha')} type="password" autoComplete="new-password" error={errors.password?.message} {...passwordField} />
          <PasswordStrengthMeter password={password} />
        </div>
        <Input label={t('confirmar')} type="password" autoComplete="new-password" error={errors.confirm?.message} {...confirmField} />
        <Button type="submit" size="lg" fullWidth loading={reset.isPending}>
          {t('salvar')}
        </Button>
      </form>
    </div>
  );
}
