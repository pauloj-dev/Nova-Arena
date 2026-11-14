'use client';

import { Button } from '@nova/ui';
import { CircleCheck, CircleX, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useConfirmEmailChange } from '@/shared/api/hooks/account';
import { useSession } from '@/shared/session/useSession';
import { AuthHeader } from './AuthParts';

/** `/confirmar-email?token=`: link enviado ao endereço novo na troca de e-mail (issue #69). */
export function ConfirmEmailChangeScreen() {
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
        <AuthHeader icon={<CircleX className="size-6" />} title="Link incompleto" description="Abra o link exatamente como chegou no seu e-mail." />
        <Button asChild fullWidth variant="secondary">
          <Link href="/">Voltar ao início</Link>
        </Button>
      </div>
    );
  }

  if (confirm.isSuccess) {
    return (
      <div className="flex flex-col gap-5">
        <AuthHeader icon={<CircleCheck className="size-6" />} title="E-mail trocado" description={`Pronto! Sua conta agora usa ${confirm.data.email}. Avisamos o endereço antigo sobre a troca.`} />
        <Button asChild fullWidth>
          <Link href={user ? '/minha-conta/seguranca' : '/entrar'}>{user ? 'Ir para Segurança' : 'Entrar'}</Link>
        </Button>
      </div>
    );
  }

  if (confirm.isError) {
    return (
      <div className="flex flex-col gap-5">
        <AuthHeader icon={<CircleX className="size-6" />} title="Não foi possível trocar o e-mail" />
        <p role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm font-medium text-danger-soft-text">
          {errorMessage(confirm.error)}
        </p>
        <p className="text-sm text-muted">Peça a troca de novo em Minha conta › Segurança: o link anterior deixa de valer.</p>
        <Button asChild fullWidth variant="secondary">
          <Link href="/minha-conta/seguranca">Ir para Segurança</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 py-6" role="status">
      <Loader2 className="size-6 animate-spin text-muted" aria-hidden />
      <p className="text-sm text-muted">Confirmando seu novo e-mail…</p>
    </div>
  );
}
