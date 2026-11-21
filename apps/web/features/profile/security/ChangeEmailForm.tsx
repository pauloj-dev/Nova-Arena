'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ChangeEmailInput } from '@nova/schemas';
import { Button, Input, useToast } from '@nova/ui';
import { MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { errorMessage } from '@/shared/api/client';
import { useChangeEmail } from '@/shared/api/hooks/account';
import { isModuleMocked } from '@/shared/api/mode';
import { useT } from '@/shared/i18n/react';
import { FormAlert, PrototypeNotice, textLink } from '@/features/auth/AuthParts';
import { applyFieldErrors, hasFieldErrors } from '@/features/auth/formErrors';
import { messages } from '../messages';

const FIELDS = ['newEmail', 'password'] as const;

/** Trocar o e-mail (issue #69): pede a senha e manda um link para o endereço novo. */
export function ChangeEmailForm() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<{ email: string; devToken?: string } | null>(null);
  const change = useChangeEmail();
  const t = useT(messages, 'ChangeEmailForm');
  const authMocked = isModuleMocked('auth');
  const toast = useToast();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<ChangeEmailInput>({ resolver: zodResolver(ChangeEmailInput), mode: 'onTouched', defaultValues: { newEmail: '', password: '' } });

  const newEmailField = register('newEmail');
  const passwordField = register('password');

  if (pending) {
    const checkInbox = t.rich('confira', { email: pending.email, destaque: (chunks) => <span className="break-all">{chunks}</span> });
    return (
      <div role="status" className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm">
        <p className="flex items-center gap-2 font-semibold">
          <MailCheck className="size-4 shrink-0" aria-hidden />
          {checkInbox}
        </p>
        <p className="text-muted">{t('abraOLink')}</p>
        {pending.devToken && authMocked && (
          <PrototypeNotice>
            <p>{t('prototipo')}</p>
            <Link href={`/confirmar-email?token=${encodeURIComponent(pending.devToken)}`} className={textLink}>
              {t('abrirLink')}
            </Link>
          </PrototypeNotice>
        )}
      </div>
    );
  }

  if (!open) {
    return (
      <Button variant="secondary" size="sm" className="self-start" onClick={() => setOpen(true)}>
        {t('trocarEmail')}
      </Button>
    );
  }

  return (
    <form
      noValidate
      className="flex max-w-md flex-col gap-3"
      onSubmit={handleSubmit((input) =>
        change.mutate(input, {
          onSuccess: (res) => {
            reset();
            setPending({ email: res.pendingEmail, devToken: res.devConfirmToken });
            toast.success(t('linkEnviado'), t('confirmePeloEmail', { email: res.pendingEmail }));
          },
          onError: (e) => {
            if (!applyFieldErrors(e, setError, FIELDS)) toast.error(t('erroTrocar'), errorMessage(e));
          },
        }),
      )}
    >
      {change.isError && !hasFieldErrors(change.error, FIELDS) && <FormAlert>{errorMessage(change.error)}</FormAlert>}
      <Input label={t('novoEmail')} type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} error={errors.newEmail?.message} {...newEmailField} />
      <Input label={t('suaSenha')} type="password" autoComplete="current-password" hint={t('suaSenhaDica')} error={errors.password?.message} {...passwordField} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={change.isPending}>
          {t('enviarLink')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            reset();
            setOpen(false);
          }}
        >
          {t('cancelar')}
        </Button>
      </div>
    </form>
  );
}
