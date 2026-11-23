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
import { useT } from '@/shared/i18n/react';
import { AuthHeader, FormAlert, PrototypeNotice, textLink } from './AuthParts';
import { messages } from './messages';

type ForgotForm = z.infer<typeof ForgotPasswordInput>;

/** `/recuperar-senha`: pede o e-mail e mostra "confira seu e-mail" — a mesma resposta exista ou não a conta. */
export function ForgotPasswordScreen() {
  const t = useT(messages, 'ForgotPasswordScreen');
  const forgot = useForgotPassword();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotForm>({ resolver: zodResolver(ForgotPasswordInput), defaultValues: { email: '' } });
  const emailField = register('email');

  if (forgot.isSuccess) {
    const token = forgot.data.devResetToken;
    const description = t.rich('confiraDescricao', {
      email: forgot.variables,
      strong: (chunks) => <strong className="text-text [overflow-wrap:anywhere]">{chunks}</strong>,
    });
    return (
      <div className="flex flex-col gap-5">
        <AuthHeader
          icon={<MailCheck className="size-6" />}
          title={t('confiraTitulo')}
          description={description}
        />
        <PrototypeNotice>
          {token ? (
            <>
              <p>{t('semEnvio')}</p>
              <Link href={`/redefinir-senha?token=${encodeURIComponent(token)}`} className={textLink}>
                {t('abrirLink')}
              </Link>
            </>
          ) : (
            <p>{t('semConta')}</p>
          )}
        </PrototypeNotice>
        <div className="flex flex-col gap-2">
          <Button variant="secondary" fullWidth onClick={() => forgot.reset()}>
            {t('outroEmail')}
          </Button>
          <Button asChild variant="ghost" fullWidth>
            <Link href="/entrar">{t('voltarEntrar')}</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <AuthHeader title={t('titulo')} description={t('descricao')} />
      <form noValidate className="flex flex-col gap-4" onSubmit={handleSubmit(({ email }) => forgot.mutate(email))}>
        {forgot.isError && <FormAlert>{errorMessage(forgot.error)}</FormAlert>}
        <Input label={t('email')} type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} error={errors.email?.message} {...emailField} />
        <Button type="submit" size="lg" fullWidth loading={forgot.isPending}>
          {t('enviar')}
        </Button>
      </form>
      <p className="text-center text-sm text-muted">
        {t('lembrou')}{' '}
        <Link href="/entrar" className={textLink}>
          {t('entrar')}
        </Link>
      </p>
    </div>
  );
}
