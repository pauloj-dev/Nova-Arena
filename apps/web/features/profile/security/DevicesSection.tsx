'use client';

import type { DeviceSession } from '@nova/schemas';
import { Badge, Button, Skeleton, useToast } from '@nova/ui';
import { LogOut, MonitorSmartphone, Smartphone } from 'lucide-react';
import { errorMessage } from '@/shared/api/client';
import { useDeviceSessions, useEndOtherSessions, useEndSession } from '@/shared/api/hooks/account';
import { formatDateTime } from '@/shared/lib/datetime';

const isPhone = (device: string) => /Android|iPhone|iPad/.test(device);

function DeviceRow({ session }: { session: DeviceSession }) {
  const end = useEndSession();
  const toast = useToast();
  const Icon = isPhone(session.device) ? Smartphone : MonitorSmartphone;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <Icon className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-semibold">{session.device}</span>
          <span className="text-sm text-muted">
            {session.current ? 'Ativo agora' : `Último acesso: ${formatDateTime(session.lastUsedAt)}`}
            {session.ip ? ` · IP ${session.ip}` : ''}
          </span>
        </div>
      </div>
      {session.current ? (
        <Badge tone="primary">Este aparelho</Badge>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          loading={end.isPending}
          iconLeft={<LogOut className="size-4" aria-hidden />}
          aria-label={`Encerrar sessão em ${session.device}`}
          onClick={() =>
            end.mutate(session.id, {
              onSuccess: () => toast.success('Sessão encerrada', `${session.device} saiu da sua conta.`),
              onError: (e) => toast.error('Não foi possível encerrar', errorMessage(e)),
            })
          }
        >
          Encerrar
        </Button>
      )}
    </li>
  );
}

/** Aparelhos com a conta aberta (issue #69): encerrar um ou todos os outros. */
export function DevicesSection() {
  const sessions = useDeviceSessions();
  const endOthers = useEndOtherSessions();
  const toast = useToast();
  const others = sessions.data?.filter((s) => !s.current).length ?? 0;

  return (
    <section aria-labelledby="seguranca-aparelhos" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="seguranca-aparelhos" className="text-lg">
          Aparelhos conectados
        </h2>
        {others > 0 && (
          <Button
            size="sm"
            variant="ghost"
            loading={endOthers.isPending}
            onClick={() =>
              endOthers.mutate(undefined, {
                onSuccess: () => toast.success('Pronto', 'Os outros aparelhos saíram da sua conta.'),
                onError: (e) => toast.error('Não foi possível encerrar', errorMessage(e)),
              })
            }
          >
            Sair de todos os outros
          </Button>
        )}
      </div>
      <p className="text-sm text-muted">Não reconhece algum? Encerre a sessão e troque sua senha.</p>
      {sessions.isPending ? (
        <div role="status" aria-label="Carregando" className="flex flex-col gap-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : sessions.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
          <span>Não foi possível carregar os aparelhos.</span>
          <Button size="sm" variant="secondary" onClick={() => void sessions.refetch()}>
            Tentar de novo
          </Button>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {sessions.data.map((s) => (
            <DeviceRow key={s.id} session={s} />
          ))}
        </ul>
      )}
      {others === 0 && sessions.isSuccess && <p className="text-sm text-muted">Sua conta só está aberta neste aparelho.</p>}
    </section>
  );
}
