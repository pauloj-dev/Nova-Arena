'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { isMinor, MIN_AGE, RegisterInput } from '@nova/schemas';
import { Button, Checkbox, Input } from '@nova/ui';
import { AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { errorMessage } from '@/shared/api/client';
import { useRegister } from '@/shared/api/hooks/users';
import { useFlags } from '@/shared/flags/useFlag';
import { useT } from '@/shared/i18n/react';
import { AuthHeader, FormAlert, textLink } from './AuthParts';
import { useDevMailbox } from './devMailbox';
import { applyFieldErrors, hasFieldErrors } from './formErrors';
import { messages } from './messages';
import { PasswordStrengthMeter } from './PasswordStrengthMeter';
import { safeNext, withNext } from './safeNext';

const FIELDS = ['nickname', 'email', 'password', 'birthDate', 'acceptTerms', 'guardianConsent'] as const;

/** Hoje, no formato do `<input type="date">`: ninguém nasceu no futuro. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** `/cadastro`: cria a conta (já logada) e leva para a tela "confira seu e-mail". */
export function RegisterScreen() {
  const t = useT(messages, 'RegisterScreen');
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
  const nicknameField = register('nickname');
  const emailField = register('email');
  const passwordField = register('password');
  const birthDateField = register('birthDate');
  // Entre a idade mínima e 18 anos, o cadastro pede a autorização do responsável (LGPD art. 14).
  const minor = isMinor(useWatch({ control, name: 'birthDate' }));

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
        <AuthHeader title={t('fechadoTitulo')} description={t('fechadoDescricao')} />
        <Button asChild fullWidth>
          <Link href={withNext('/entrar', next)}>{t('entrar')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <AuthHeader title={t('titulo')} description={t('descricao')} />

      <form noValidate className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)}>
        {generalError && <FormAlert>{generalError}</FormAlert>}
        <Input
          label={t('apelido')}
          autoComplete="nickname"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={20}
          hint={t('apelidoDica')}
          error={errors.nickname?.message}
          {...nicknameField}
        />
        <Input label={t('email')} type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} error={errors.email?.message} {...emailField} />
        <div className="flex flex-col gap-1.5">
          <Input label={t('senha')} type="password" autoComplete="new-password" error={errors.password?.message} {...passwordField} />
          <PasswordStrengthMeter password={password} />
        </div>
        <Input
          label={t('nascimento')}
          type="date"
          autoComplete="bday"
          max={today()}
          hint={t('nascimentoDica', { idade: MIN_AGE })}
          error={errors.birthDate?.message}
          {...birthDateField}
        />
        {minor && (
          <div className="flex flex-col gap-1">
            <Controller
              control={control}
              name="guardianConsent"
              render={({ field }) => (
                <Checkbox
                  label={t('responsavel')}
                  hint={t('responsavelDica')}
                  checked={field.value === true}
                  onCheckedChange={(checked) => field.onChange(checked)}
                />
              )}
            />
            {errors.guardianConsent?.message && (
              <p role="alert" className="flex items-center gap-1 text-xs font-medium text-danger">
                <AlertCircle className="size-3.5 shrink-0" aria-hidden />
                {errors.guardianConsent.message}
              </p>
            )}
          </div>
        )}
        <div className="flex flex-col gap-1">
          <Controller
            control={control}
            name="acceptTerms"
            render={({ field }) => (
              <Checkbox
                label={t.rich('termos', {
                  termos: (chunks) => (
                    <Link href="/termos" target="_blank" className="font-semibold text-primary-text underline">
                      {chunks}
                    </Link>
                  ),
                  privacidade: (chunks) => (
                    <Link href="/privacidade" target="_blank" className="font-semibold text-primary-text underline">
                      {chunks}
                    </Link>
                  ),
                })}
                hint={t('termosDica')}
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
          {t('criarConta')}
        </Button>
      </form>

      <p className="text-center text-sm text-muted">
        {t('jaTemConta')}{' '}
        <Link href={withNext('/entrar', next)} className={textLink}>
          {t('entrar')}
        </Link>
      </p>
    </div>
  );
}
