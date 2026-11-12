import { Badge } from '@nova/ui';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';

/** E-mail da conta (somente leitura) com o estado da verificação em ícone + texto. */
export function EmailStatus({ email, verified }: { email: string; verified: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-text">E-mail</span>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 break-all text-sm text-text">{email}</span>
        {verified ? (
          <Badge tone="primary" icon={<CheckCircle2 className="size-3.5" aria-hidden />}>
            Verificado
          </Badge>
        ) : (
          <Badge tone="warning" icon={<AlertTriangle className="size-3.5" aria-hidden />}>
            Não verificado
          </Badge>
        )}
      </div>
      {verified ? (
        <p className="text-xs text-muted">O e-mail é usado para entrar e para os avisos da conta. Ele não aparece no seu perfil público.</p>
      ) : (
        <p className="text-xs text-muted">
          Confirme seu e-mail para aceitar convites e proteger a conta.{' '}
          <Link href="/verificar-email" className="font-semibold text-primary-text underline underline-offset-2">
            Verificar e-mail
          </Link>
        </p>
      )}
    </div>
  );
}
