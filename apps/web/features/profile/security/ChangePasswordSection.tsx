'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ChangePasswordInput } from '@nova/schemas';
import { Button, Input, useToast } from '@nova/ui';
import { KeyRound } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import { errorMessage } from '@/shared/api/client';
import { useChangePassword } from '@/shared/api/hooks/account';
import { useLoginMethods } from '@/shared/api/hooks/login-methods';
import { FormAlert } from '@/features/auth/AuthParts';
import { applyFieldErrors, hasFieldErrors } from '@/features/auth/formErrors';
import { PasswordStrengthMeter } from '@/features/auth/PasswordStrengthMeter';

const FIELDS = ['currentPassword', 'newPassword'] as const;

/** Trocar a senha (issue #69). Conta sem senha (só Google/Discord) define a primeira em "Jeitos de entrar". */
export function ChangePasswordSection() {
  const methods = useLoginMethods();
  const change = useChangePassword();
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

  // Sem senha ainda: quem cuida é a seção "Jeitos de entrar".
  if (methods.data && !methods.data.hasPassword) return null;

  return (
    <section aria-labelledby="seguranca-senha" className="flex flex-col gap-3">
      <h2 id="seguranca-senha" className="text-lg">
        Senha
      </h2>
      <p className="text-sm text-muted">Ao trocar a senha, os outros aparelhos saem da sua conta. Este continua conectado.</p>
      <form
        noValidate
        className="flex max-w-md flex-col gap-3"
        onSubmit={handleSubmit((input) =>
          change.mutate(input, {
            onSuccess: () => {
              reset();
              toast.success('Senha trocada', 'Os outros aparelhos saíram da sua conta.');
            },
            onError: (e) => {
              if (!applyFieldErrors(e, setError, FIELDS)) toast.error('Não foi possível trocar a senha', errorMessage(e));
            },
          }),
        )}
      >
        {change.isError && !hasFieldErrors(change.error, FIELDS) && <FormAlert>{errorMessage(change.error)}</FormAlert>}
        <Input label="Senha atual" type="password" autoComplete="current-password" error={errors.currentPassword?.message} {...register('currentPassword')} />
        <div className="flex flex-col gap-2">
          <Input label="Nova senha" type="password" autoComplete="new-password" error={errors.newPassword?.message} {...register('newPassword')} />
          <PasswordStrengthMeter password={newPassword} />
        </div>
        <Button type="submit" className="self-start" loading={change.isPending} iconLeft={<KeyRound className="size-4" aria-hidden />}>
          Trocar senha
        </Button>
      </form>
    </section>
  );
}
