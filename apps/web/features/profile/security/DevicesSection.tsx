'use client';

import type { DeviceSession } from '@nova/schemas';
import { Badge, Button, Skeleton, useToast } from '@nova/ui';
import { LogOut, MonitorSmartphone, Smartphone } from 'lucide-react';
import { errorMessage } from '@/shared/api/client';
import { useDeviceSessions, useEndOtherSessions, useEndSession } from '@/shared/api/hooks/account';
import { useT } from '@/shared/i18n/react';
import { formatDateTime } from '@/shared/lib/datetime';
import { messages } from '../messages';

const isPhone = (device: string) => /Android|iPhone|iPad/.test(device);

function DeviceRow({ session }: { session: DeviceSession }) {
  const end = useEndSession();
  const t = useT(messages, 'DevicesSection');
  const toast = useToast();
  const Icon = isPhone(session.device) ? Smartphone : MonitorSmartphone;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <Icon className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-semibold">{session.device}</span>
          <span className="text-sm text-muted">
            {session.current ? t('ativoAgora') : t('ultimoAcesso', { data: formatDateTime(session.lastUsedAt) })}
            {session.ip ? t('ip', { ip: session.ip }) : ''}
          </span>
        </div>
      </div>
      {session.current ? (
        <Badge tone="primary">{t('esteAparelho')}</Badge>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          loading={end.isPending}
          iconLeft={<LogOut className="size-4" aria-hidden />}
          aria-label={t('encerrarEm', { aparelho: session.device })}
          onClick={() =>
            end.mutate(session.id, {
              onSuccess: () => toast.success(t('sessaoEncerrada'), t('saiuDaConta', { aparelho: session.device })),
              onError: (e) => toast.error(t('erroEncerrar'), errorMessage(e)),
            })
          }
        >
          {t('encerrar')}
        </Button>
      )}
    </li>
  );
}

/** Aparelhos com a conta aberta (issue #69): encerrar um ou todos os outros. */
export function DevicesSection() {
  const sessions = useDeviceSessions();
  const endOthers = useEndOtherSessions();
  const t = useT(messages, 'DevicesSection');
  const toast = useToast();
  const others = sessions.data?.filter((s) => !s.current).length ?? 0;

  return (
    <section aria-labelledby="seguranca-aparelhos" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="seguranca-aparelhos" className="text-lg">
          {t('titulo')}
        </h2>
        {others > 0 && (
          <Button
            size="sm"
            variant="ghost"
            loading={endOthers.isPending}
            onClick={() =>
              endOthers.mutate(undefined, {
                onSuccess: () => toast.success(t('pronto'), t('outrosSairam')),
                onError: (e) => toast.error(t('erroEncerrar'), errorMessage(e)),
              })
            }
          >
            {t('sairDeTodos')}
          </Button>
        )}
      </div>
      <p className="text-sm text-muted">{t('naoReconhece')}</p>
      {sessions.isPending ? (
        <div role="status" aria-label={t('carregando')} className="flex flex-col gap-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : sessions.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
          <span>{t('erroCarregar')}</span>
          <Button size="sm" variant="secondary" onClick={() => void sessions.refetch()}>
            {t('tentarDeNovo')}
          </Button>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {sessions.data.map((s) => (
            <DeviceRow key={s.id} session={s} />
          ))}
        </ul>
      )}
      {others === 0 && sessions.isSuccess && <p className="text-sm text-muted">{t('soEste')}</p>}
    </section>
  );
}
