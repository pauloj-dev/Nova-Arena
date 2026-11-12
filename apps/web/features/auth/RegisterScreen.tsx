'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { MIN_AGE, RegisterInput } from '@nova/schemas';
import { Button, Checkbox, Input } from '@nova/ui';
import { AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { errorMessage } from '@/shared/api/client';
import { useRegister } from '@/shared/api/hooks/users';
import { useFlags } from '@/shared/flags/useFlag';
import { AuthHeader, FormAlert, textLink } from './AuthParts';
import { useDevMailbox } from './devMailbox';
import { applyFieldErrors, hasFieldErrors } from './formErrors';
import { PasswordStrengthMeter } from './PasswordStrengthMeter';
import { safeNext, withNext } from './safeNext';

const FIELDS = ['nickname', 'email', 'password', 'birthDate', 'acceptTerms'] as const;

/** Hoje, no formato do `<input type="date">`: ninguém nasceu no futuro. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** `/cadastro`: cria a conta (já logada) e leva para a tela "confira seu e-mail". */
export function RegisterScreen() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const signUp = useRegister();
  const flags = useFlags();
  const setVerifyToken = useDevMailbox((s) => s.setVerifyToken);
  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors },
  } = useForm<RegisterInput>({
    resolver: zodResolver(RegisterInput),
    mode: 'onTouched',
    defaultValues: { nickname: '', email: '', password: '', birthDate: '' },
  });
  const password = useWatch({ control, name: 'password' }) ?? '';

  // Erro que não pertence a nenhum campo (os 409 de e-mail e apelido vão para o campo).
  const generalError = signUp.isError && !hasFieldErrors(signUp.error, FIELDS) ? errorMessage(signUp.error) : null;

  function onSubmit(input: RegisterInput) {
    signUp.mutate(input, {
      onSuccess: ({ user, devVerifyToken }) => {
        setVerifyToken(user.email, devVerifyToken);
        router.push(withNext('/verificar-email', next));
      },
      onError: (e) => {
        applyFieldErrors(e, setError, FIELDS);
      },
    });
  }

  // O cadastro público pode ser fechado nas configurações do site (flag `publicSignup`), por exemplo durante o beta.
  if (!flags.isLoading && !flags.flags.publicSignup) {
    return (
      <div className="flex flex-col gap-5">
        <AuthHeader title="Cadastro fechado no momento" description="A Nova Arena está recebendo novas contas só por convite. Se você já tem conta, é só entrar." />
        <Button asChild fullWidth>
          <Link href={withNext('/entrar', next)}>Entrar</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <AuthHeader title="Criar conta" description="É grátis. Em um minuto você já pode se inscrever em um campeonato." />

      <form noValidate className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)}>
        {generalError && <FormAlert>{generalError}</FormAlert>}
        <Input
          label="Apelido"
          autoComplete="nickname"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={20}
          hint="É como os outros jogadores vão ver você. De 3 a 20 caracteres: letras, números, ponto, hífen e sublinhado."
          error={errors.nickname?.message}
          {...register('nickname')}
        />
        <Input label="E-mail" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} error={errors.email?.message} {...register('email')} />
        <div className="flex flex-col gap-1.5">
          <Input label="Senha" type="password" autoComplete="new-password" error={errors.password?.message} {...register('password')} />
          <PasswordStrengthMeter password={password} />
        </div>
        <Input
          label="Data de nascimento"
          type="date"
          autoComplete="bday"
          max={today()}
          hint={`É preciso ter pelo menos ${MIN_AGE} anos. A data não aparece no seu perfil.`}
          error={errors.birthDate?.message}
          {...register('birthDate')}
        />
        <div className="flex flex-col gap-1">
          <Controller
            control={control}
            name="acceptTerms"
            render={({ field }) => (
              <Checkbox
                label={
                  <>
                    Li e aceito os{' '}
                    <Link href="/termos" target="_blank" className="font-semibold text-primary-text underline">
                      Termos de Uso
                    </Link>{' '}
                    e a{' '}
                    <Link href="/privacidade" target="_blank" className="font-semibold text-primary-text underline">
                      Política de Privacidade
                    </Link>
                  </>
                }
                hint="Usamos seus dados só para a sua conta e os campeonatos em que você entrar."
                checked={field.value === true}
                onCheckedChange={(checked) => field.onChange(checked)}
              />
            )}
          />
          {errors.acceptTerms?.message && (
            <p role="alert" className="flex items-center gap-1 text-xs font-medium text-danger">
              <AlertCircle className="size-3.5 shrink-0" aria-hidden />
              {errors.acceptTerms.message}
            </p>
          )}
        </div>
        <Button type="submit" size="lg" fullWidth loading={signUp.isPending}>
          Criar conta
        </Button>
      </form>

      <p className="text-center text-sm text-muted">
        Já tem conta?{' '}
        <Link href={withNext('/entrar', next)} className={textLink}>
          Entrar
        </Link>
      </p>
    </div>
  );
}
