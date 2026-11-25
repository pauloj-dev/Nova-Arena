'use client';

import { Badge, Button, Card, ErrorState, StatusPill } from '@nova/ui';
import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { errorMessage } from '@/shared/api/client';
import { useMyStaffTournaments } from '@/shared/api/hooks/organizer-ops';
import { useT } from '@/shared/i18n/react';
import { formatDateTime } from '@/shared/lib/datetime';
import { messages } from './messages';

/**
 * Campeonatos em que a pessoa faz parte da equipe (co-organizadora ou moderadora). Quem entrou na equipe por um link
 * sem ter o papel de organizador não tem a área do organizador: é por aqui que chega à gestão do campeonato.
 * Some quando a pessoa não ajuda a organizar nenhum.
 */
export function StaffTournamentsSection({ enabled }: { enabled: boolean }) {
  const t = useT(messages, 'StaffTournaments');
  const query = useMyStaffTournaments(enabled);

  // Enquanto carrega (e quando a lista vem vazia) a seção não ocupa espaço: quase ninguém faz parte de uma equipe,
  // e um esqueleto que some empurraria a página.
  if (query.isPending || (query.isSuccess && query.data.length === 0)) return null;
  if (query.isError) return <ErrorState className="mt-8" title={t('erro')} description={errorMessage(query.error)} onRetry={() => void query.refetch()} />;

  return (
    <section className="mt-8 flex flex-col gap-3" aria-labelledby="ajudo-a-organizar">
      <div className="flex flex-col gap-1">
        <h2 id="ajudo-a-organizar" className="text-lg">
          {t('titulo')}
        </h2>
        <p className="text-sm text-muted">{t('descricao')}</p>
      </div>
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {query.data.map((item) => (
          <li key={item.id}>
            <Card className="flex h-full flex-col gap-3" data-testid="staff-tournament">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={item.status} />
                <Badge tone="accent" icon={<ShieldCheck className="size-3.5" aria-hidden />}>
                  {t('papel', { papel: item.role })}
                </Badge>
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-text [overflow-wrap:anywhere]">{item.name}</p>
                <p className="text-sm text-muted">
                  {item.gameName} · {item.startsAt ? t('inicio', { data: formatDateTime(item.startsAt) }) : t('semData')}
                </p>
              </div>
              <div className="mt-auto">
                <Button asChild size="sm" variant="secondary">
                  <Link href={`/organizador/campeonatos/${item.id}`} aria-label={t('gerenciarRotulo', { nome: item.name })}>
                    {t('gerenciar')}
                  </Link>
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
