'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ChangePasswordInput } from '@nova/schemas';
import { Button, Input, useToast } from '@nova/ui';
import { KeyRound } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import { errorMessage } from '@/shared/api/client';
import { useChangePassword } from '@/shared/api/hooks/account';
import { useLoginMethods } from '@/shared/api/hooks/login-methods';
import { useT } from '@/shared/i18n/react';
import { FormAlert } from '@/features/auth/AuthParts';
import { applyFieldErrors, hasFieldErrors } from '@/features/auth/formErrors';
import { PasswordStrengthMeter } from '@/features/auth/PasswordStrengthMeter';
import { messages } from '../messages';

const FIELDS = ['currentPassword', 'newPassword'] as const;

/** Trocar a senha (issue #69). Conta sem senha (só Google/Discord) define a primeira em "Jeitos de entrar". */
export function ChangePasswordSection() {
  const methods = useLoginMethods();
  const change = useChangePassword();
  const t = useT(messages, 'ChangePasswordSection');
  const toast = useToast();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    control,
    formState: { errors },
  } = useForm<ChangePasswordInput>({ resolver: zodResolver(ChangePasswordInput), mode: 'onTouched', defaultValues: { currentPassword: '', newPassword: '' } });
  const newPassword = useWatch({ control, name: 'newPassword' });
  const currentPasswordField = register('currentPassword');
  const newPasswordField = register('newPassword');

  // Sem senha ainda: quem cuida é a seção "Jeitos de entrar".
  if (methods.data && !methods.data.hasPassword) return null;

  return (
    <section aria-labelledby="seguranca-senha" className="flex flex-col gap-3">
      <h2 id="seguranca-senha" className="text-lg">
        {t('senha')}
      </h2>
      <p className="text-sm text-muted">{t('aviso')}</p>
      <form
        noValidate
        className="flex max-w-md flex-col gap-3"
        onSubmit={handleSubmit((input) =>
          change.mutate(input, {
            onSuccess: () => {
              reset();
              toast.success(t('senhaTrocada'), t('outrosSairam'));
            },
            onError: (e) => {
              if (!applyFieldErrors(e, setError, FIELDS)) toast.error(t('erroTrocar'), errorMessage(e));
            },
          }),
        )}
      >
        {change.isError && !hasFieldErrors(change.error, FIELDS) && <FormAlert>{errorMessage(change.error)}</FormAlert>}
        <Input label={t('senhaAtual')} type="password" autoComplete="current-password" error={errors.currentPassword?.message} {...currentPasswordField} />
        <div className="flex flex-col gap-2">
          <Input label={t('novaSenha')} type="password" autoComplete="new-password" error={errors.newPassword?.message} {...newPasswordField} />
          <PasswordStrengthMeter password={newPassword} />
        </div>
        <Button type="submit" className="self-start" loading={change.isPending} iconLeft={<KeyRound className="size-4" aria-hidden />}>
          {t('trocarSenha')}
        </Button>
      </form>
    </section>
  );
}
