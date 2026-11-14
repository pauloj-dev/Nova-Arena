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
import { FormAlert, PrototypeNotice, textLink } from '@/features/auth/AuthParts';
import { applyFieldErrors, hasFieldErrors } from '@/features/auth/formErrors';

const FIELDS = ['newEmail', 'password'] as const;

/** Trocar o e-mail (issue #69): pede a senha e manda um link para o endereço novo. */
export function ChangeEmailForm() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<{ email: string; devToken?: string } | null>(null);
  const change = useChangeEmail();
  const toast = useToast();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<ChangeEmailInput>({ resolver: zodResolver(ChangeEmailInput), mode: 'onTouched', defaultValues: { newEmail: '', password: '' } });

  if (pending) {
    return (
      <div role="status" className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm">
        <p className="flex items-center gap-2 font-semibold">
          <MailCheck className="size-4 shrink-0" aria-hidden />
          Confira a caixa de entrada de <span className="break-all">{pending.email}</span>
        </p>
        <p className="text-muted">Abra o link que mandamos para concluir a troca. Até lá, seu e-mail atual continua valendo.</p>
        {pending.devToken && isModuleMocked('auth') && (
          <PrototypeNotice>
            <p>Nenhum e-mail é enviado de verdade. Este é o link que chegaria no endereço novo:</p>
            <Link href={`/confirmar-email?token=${encodeURIComponent(pending.devToken)}`} className={textLink}>
              Abrir link de confirmação
            </Link>
          </PrototypeNotice>
        )}
      </div>
    );
  }

  if (!open) {
    return (
      <Button variant="secondary" size="sm" className="self-start" onClick={() => setOpen(true)}>
        Trocar e-mail
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
            toast.success('Link enviado', `Confirme pelo e-mail enviado para ${res.pendingEmail}.`);
          },
          onError: (e) => {
            if (!applyFieldErrors(e, setError, FIELDS)) toast.error('Não foi possível trocar o e-mail', errorMessage(e));
          },
        }),
      )}
    >
      {change.isError && !hasFieldErrors(change.error, FIELDS) && <FormAlert>{errorMessage(change.error)}</FormAlert>}
      <Input label="Novo e-mail" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} error={errors.newEmail?.message} {...register('newEmail')} />
      <Input label="Sua senha" type="password" autoComplete="current-password" hint="Para confirmar que é você." error={errors.password?.message} {...register('password')} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={change.isPending}>
          Enviar link de confirmação
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            reset();
            setOpen(false);
          }}
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}
