import { Badge } from '@nova/ui';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { getT } from '@/shared/i18n/core';
import { messages } from './messages';

/** E-mail da conta (somente leitura) com o estado da verificação em ícone + texto. */
export function EmailStatus({ email, verified }: { email: string; verified: boolean }) {
  const t = getT(messages, 'EmailStatus');
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-text">{t('email')}</span>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 break-all text-sm text-text">{email}</span>
        {verified ? (
          <Badge tone="primary" icon={<CheckCircle2 className="size-3.5" aria-hidden />}>
            {t('verificado')}
          </Badge>
        ) : (
          <Badge tone="warning" icon={<AlertTriangle className="size-3.5" aria-hidden />}>
            {t('naoVerificado')}
          </Badge>
        )}
      </div>
      {verified ? (
        <p className="text-xs text-muted">{t('usoVerificado')}</p>
      ) : (
        <p className="text-xs text-muted">
          {t('confirme')}{' '}
          <Link href="/verificar-email" className="font-semibold text-primary-text underline underline-offset-2">
            {t('verificarEmail')}
          </Link>
        </p>
      )}
    </div>
  );
}
