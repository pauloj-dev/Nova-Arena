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
import { AuthHeader, FormAlert } from './AuthParts';
import { applyFieldErrors, hasFieldErrors } from './formErrors';
import { PasswordStrengthMeter } from './PasswordStrengthMeter';

/** A mesma regra de senha da API, mais a confirmação (que não sai do navegador). */
const ResetForm = ResetPasswordInput.pick({ password: true })
  .extend({ confirm: z.string().min(1, 'Repita a nova senha') })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'As senhas não são iguais' });
type ResetForm = z.infer<typeof ResetForm>;

/** `/redefinir-senha?token=...`: cria a nova senha a partir do link do e-mail. */
export function ResetPasswordScreen() {
  const token = useSearchParams().get('token');
  const reset = useResetPassword();
  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors },
  } = useForm<ResetForm>({ resolver: zodResolver(ResetForm), mode: 'onTouched', defaultValues: { password: '', confirm: '' } });
  const password = useWatch({ control, name: 'password' }) ?? '';

  if (!token) {
    return (
      <div className="flex flex-col gap-5">
        <AuthHeader
          icon={<CircleX className="size-6" />}
          title="Link de redefinição incompleto"
          description="Este endereço não tem o código de redefinição. Abra o link completo do e-mail ou peça um novo."
        />
        <Button asChild fullWidth>
          <Link href="/recuperar-senha">Pedir um novo link</Link>
        </Button>
      </div>
    );
  }

  if (reset.isSuccess) {
    return (
      <div className="flex flex-col gap-5">
        <AuthHeader icon={<CircleCheck className="size-6" />} title="Senha alterada" description="Sua nova senha já está valendo. Use-a para entrar na sua conta." />
        <Button asChild fullWidth>
          <Link href="/entrar">Entrar</Link>
        </Button>
      </div>
    );
  }

  const generalError = reset.isError && !hasFieldErrors(reset.error, ['password']) ? errorMessage(reset.error) : null;

  return (
    <div className="flex flex-col gap-5">
      <AuthHeader title="Criar nova senha" description="Escolha uma senha que você não usa em outros sites." />
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
              Pedir um novo link
            </Link>
          </FormAlert>
        )}
        <div className="flex flex-col gap-1.5">
          <Input label="Nova senha" type="password" autoComplete="new-password" error={errors.password?.message} {...register('password')} />
          <PasswordStrengthMeter password={password} />
        </div>
        <Input label="Confirmar nova senha" type="password" autoComplete="new-password" error={errors.confirm?.message} {...register('confirm')} />
        <Button type="submit" size="lg" fullWidth loading={reset.isPending}>
          Salvar nova senha
        </Button>
      </form>
    </div>
  );
}
