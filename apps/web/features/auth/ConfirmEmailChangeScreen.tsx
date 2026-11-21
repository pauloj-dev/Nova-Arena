'use client';

import { Button } from '@nova/ui';
import { CircleCheck, CircleX, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useConfirmEmailChange } from '@/shared/api/hooks/account';
import { useT } from '@/shared/i18n/react';
import { useSession } from '@/shared/session/useSession';
import { AuthHeader } from './AuthParts';
import { messages } from './messages';

/** `/confirmar-email?token=`: link enviado ao endereço novo na troca de e-mail (issue #69). */
export function ConfirmEmailChangeScreen() {
  const t = useT(messages, 'ConfirmEmailChangeScreen');
  const token = useSearchParams().get('token');
  const { user } = useSession();
  const confirm = useConfirmEmailChange();
  const { mutate } = confirm;

  // O link é de uso único: em StrictMode o efeito roda duas vezes, e a segunda chamada falharia.
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (!token || sent.current === token) return;
    sent.current = token;
    mutate(token);
  }, [token, mutate]);

  if (!token) {
    return (
      <div className="flex flex-col gap-5">
        <AuthHeader icon={<CircleX className="size-6" />} title={t('incompletoTitulo')} description={t('incompletoDescricao')} />
        <Button asChild fullWidth variant="secondary">
          <Link href="/">{t('voltarInicio')}</Link>
        </Button>
      </div>
    );
  }

  if (confirm.isSuccess) {
    return (
      <div className="flex flex-col gap-5">
        <AuthHeader icon={<CircleCheck className="size-6" />} title={t('trocadoTitulo')} description={t('trocadoDescricao', { email: confirm.data.email })} />
        <Button asChild fullWidth>
          <Link href={user ? '/minha-conta/seguranca' : '/entrar'}>{user ? t('irSeguranca') : t('entrar')}</Link>
        </Button>
      </div>
    );
  }

  if (confirm.isError) {
    return (
      <div className="flex flex-col gap-5">
        <AuthHeader icon={<CircleX className="size-6" />} title={t('erroTitulo')} />
        <p role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm font-medium text-danger-soft-text">
          {errorMessage(confirm.error)}
        </p>
        <p className="text-sm text-muted">{t('erroDescricao')}</p>
        <Button asChild fullWidth variant="secondary">
          <Link href="/minha-conta/seguranca">{t('irSeguranca')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 py-6" role="status">
      <Loader2 className="size-6 animate-spin text-muted" aria-hidden />
      <p className="text-sm text-muted">{t('confirmando')}</p>
    </div>
  );
}
