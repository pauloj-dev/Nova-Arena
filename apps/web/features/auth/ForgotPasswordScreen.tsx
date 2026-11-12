'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ForgotPasswordInput } from '@nova/schemas';
import { Button, Input } from '@nova/ui';
import { MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { errorMessage } from '@/shared/api/client';
import { useForgotPassword } from '@/shared/api/hooks/users';
import { AuthHeader, FormAlert, PrototypeNotice, textLink } from './AuthParts';

type ForgotForm = z.infer<typeof ForgotPasswordInput>;

/** `/recuperar-senha`: pede o e-mail e mostra "confira seu e-mail" — a mesma resposta exista ou não a conta. */
export function ForgotPasswordScreen() {
  const forgot = useForgotPassword();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotForm>({ resolver: zodResolver(ForgotPasswordInput), defaultValues: { email: '' } });

  if (forgot.isSuccess) {
    const token = forgot.data.devResetToken;
    return (
      <div className="flex flex-col gap-5">
        <AuthHeader
          icon={<MailCheck className="size-6" />}
          title="Confira seu e-mail"
          description={
            <>
              Se existir uma conta com <strong className="text-text [overflow-wrap:anywhere]">{forgot.variables}</strong>, você vai receber um link para criar uma nova senha. O link vale para um uso só.
            </>
          }
        />
        <PrototypeNotice>
          {token ? (
            <>
              <p>Nenhum e-mail é enviado de verdade. Este é o link que chegaria na sua caixa de entrada:</p>
              <Link href={`/redefinir-senha?token=${encodeURIComponent(token)}`} className={textLink}>
                Abrir link de redefinição
              </Link>
            </>
          ) : (
            <p>Nenhum link foi gerado porque não há conta com esse e-mail. No produto real, esta tela não revela isso.</p>
          )}
        </PrototypeNotice>
        <div className="flex flex-col gap-2">
          <Button variant="secondary" fullWidth onClick={() => forgot.reset()}>
            Usar outro e-mail
          </Button>
          <Button asChild variant="ghost" fullWidth>
            <Link href="/entrar">Voltar para entrar</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <AuthHeader title="Recuperar senha" description="Informe o e-mail da sua conta. Mandamos um link para você criar uma nova senha." />
      <form noValidate className="flex flex-col gap-4" onSubmit={handleSubmit(({ email }) => forgot.mutate(email))}>
        {forgot.isError && <FormAlert>{errorMessage(forgot.error)}</FormAlert>}
        <Input label="E-mail" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} error={errors.email?.message} {...register('email')} />
        <Button type="submit" size="lg" fullWidth loading={forgot.isPending}>
          Enviar link
        </Button>
      </form>
      <p className="text-center text-sm text-muted">
        Lembrou a senha?{' '}
        <Link href="/entrar" className={textLink}>
          Entrar
        </Link>
      </p>
    </div>
  );
}
