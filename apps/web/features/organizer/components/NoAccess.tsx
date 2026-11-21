import { Button, EmptyState } from '@nova/ui';
import { ShieldX } from 'lucide-react';
import Link from 'next/link';
import { getT } from '@/shared/i18n/core';
import { PageContainer } from '@/shared/layout/AreaShell';
import { messages } from '../messages';

/** 403 dentro da área: a pessoa é organizadora, mas este campeonato é de outra organização. */
export function NoAccess() {
  const t = getT(messages, 'NoAccess');
  return (
    <PageContainer narrow>
      <EmptyState
        icon={<ShieldX className="size-7" />}
        title={t('titulo')}
        description={t('descricao')}
        action={
          <Button asChild>
            <Link href="/organizador/campeonatos">{t('verMeusCampeonatos')}</Link>
          </Button>
        }
      />
      <p className="sr-only">{t('erro403')}</p>
    </PageContainer>
  );
}

/** 404 dentro da área. */
export function TournamentNotFound() {
  const t = getT(messages, 'TournamentNotFound');
  return (
    <PageContainer narrow>
      <EmptyState
        title={t('titulo')}
        description={t('descricao')}
        action={
          <Button asChild>
            <Link href="/organizador/campeonatos">{t('verMeusCampeonatos')}</Link>
          </Button>
        }
      />
    </PageContainer>
  );
}
