'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { LoginInput } from '@nova/schemas';
import { Button, Input } from '@nova/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { errorMessage } from '@/shared/api/client';
import { useLogin, useSession } from '@/shared/session/useSession';
import { AuthHeader, AuthSkeleton, FormAlert, textLink } from './AuthParts';
import { oauthErrorMessage } from './oauthErrors';
import { safeNext, withNext } from './safeNext';
import { SocialButtons } from './SocialButtons';
import { TwoFactorStep } from './TwoFactorStep';

/**
 * `/entrar`: e-mail + senha, com volta para a página de origem (`?next=`). Para quem tem a verificação em duas
 * etapas ativa, a senha leva ao passo do código (`?etapa=codigo` quando chega do login social).
 */
export function LoginScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const socialError = oauthErrorMessage(params.get('erro'));
  const { user, isLoading } = useSession();
  const login = useLogin();
  const [step, setStep] = useState<'password' | 'code'>(params.get('etapa') === 'codigo' ? 'code' : 'password');
  const [expired, setExpired] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(LoginInput), defaultValues: { email: '', password: '' } });

  // Quem já está logado (ou acabou de entrar) não fica nesta tela.
  useEffect(() => {
    if (user) router.replace(next);
  }, [user, router, next]);

  if (isLoading || user) return <AuthSkeleton />;

  if (step === 'code') {
    return (
      <TwoFactorStep
        onDone={() => router.replace(next)}
        onRestart={(message) => {
          setExpired(message);
          setStep('password');
        }}
      />
    );
  }

  function submit(input: LoginInput) {
    setExpired(null);
    login.mutate(input, {
      onSuccess: (result) => {
        if ('twoFactorRequired' in result) setStep('code');
        else router.replace(next);
      },
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <AuthHeader title="Entrar" description="Acesse sua conta para se inscrever, montar seu squad e acompanhar suas partidas." />

      <form noValidate className="flex flex-col gap-4" onSubmit={handleSubmit(submit)}>
        {login.isError ? <FormAlert>{errorMessage(login.error)}</FormAlert> : expired ? <FormAlert>{expired}</FormAlert> : socialError && <FormAlert>{socialError}</FormAlert>}
        <Input label="E-mail" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} error={errors.email?.message} {...register('email')} />
        <div className="flex flex-col gap-1.5">
          <Input label="Senha" type="password" autoComplete="current-password" error={errors.password?.message} {...register('password')} />
          <Link href="/recuperar-senha" className={`${textLink} self-end py-1 text-sm`}>
            Esqueci a senha
          </Link>
        </div>
        <Button type="submit" size="lg" fullWidth loading={login.isPending}>
          Entrar
        </Button>
      </form>

      <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-muted">
        <span className="h-px flex-1 bg-border" aria-hidden />
        ou
        <span className="h-px flex-1 bg-border" aria-hidden />
      </div>

      <SocialButtons next={next} onSignedIn={() => router.replace(next)} />

      <p className="text-center text-sm text-muted">
        Ainda não tem conta?{' '}
        <Link href={withNext('/cadastro', next)} className={textLink}>
          Criar conta
        </Link>
      </p>
    </div>
  );
}
