'use client';

import { Button, Card, ErrorState, Skeleton } from '@nova/ui';
import { Flag, HelpCircle, Mail, Scale } from 'lucide-react';
import Link from 'next/link';
import { errorMessage } from '@/shared/api/client';
import { usePublicSiteSettings } from '@/shared/api/hooks/admin-settings';
import { useT } from '@/shared/i18n/react';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { messages } from './messages';

const OUTROS_CAMINHOS = [
  { href: '/ajuda', icon: HelpCircle, chave: 'ajuda' },
  { href: '/minha-conta/denuncias', icon: Flag, chave: 'denuncias' },
  { href: '/ajuda#contestar', icon: Scale, chave: 'contestar' },
] as const;

/**
 * Contato com o suporte (issue 110). O e-mail vem das configurações do site (`GET /site/settings`), que o
 * Super Admin edita em Configurações — nada fica fixo no código.
 */
export function ContactPage() {
  const settings = usePublicSiteSettings();
  const t = useT(messages, 'ContactPage');
  const subject = encodeURIComponent(t('assuntoEmail'));

  return (
    <PageContainer narrow>
      <PageHeader title={t('titulo')} description={t('descricao')} />

      <Card className="flex flex-col gap-4">
        <h2 className="flex items-center gap-2 text-lg">
          <Mail className="size-5 text-primary-text" aria-hidden />
          {t('emailSuporte')}
        </h2>
        {settings.isPending ? (
          <div className="flex flex-col gap-2" role="status" aria-label={t('carregando')}>
            <Skeleton className="h-6 w-64 max-w-full" />
            <Skeleton className="h-11 w-48" />
          </div>
        ) : settings.isError ? (
          <ErrorState title={t('erro')} description={errorMessage(settings.error)} onRetry={() => void settings.refetch()} />
        ) : (
          <>
            <p className="break-all font-display text-xl font-bold text-text" data-testid="support-email">
              {settings.data.supportEmail}
            </p>
            <div>
              <Button asChild>
                <a href={`mailto:${settings.data.supportEmail}?subject=${subject}`}>
                  <Mail className="size-4" aria-hidden />
                  {t('escrever')}
                </a>
              </Button>
            </div>
          </>
        )}
        <div className="flex flex-col gap-1 text-sm">
          <h3 className="font-semibold">{t('conte')}</h3>
          <ul className="list-disc pl-5 text-muted">
            <li>{t('conte1')}</li>
            <li>{t('conte2')}</li>
            <li>{t('conte3')}</li>
          </ul>
          <p className="text-muted">{t('senha')}</p>
        </div>
      </Card>

      <section aria-labelledby="outros-caminhos" className="flex flex-col gap-3">
        <h2 id="outros-caminhos" className="text-lg">
          {t('outrosCaminhos')}
        </h2>
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {OUTROS_CAMINHOS.map((c) => (
            <li key={c.href}>
              <Link href={c.href} className="flex h-full min-h-11 flex-col gap-1 rounded-lg border border-border bg-surface p-4 shadow-sm transition-shadow hover:shadow-md">
                <span className="flex items-center gap-2 font-semibold text-text">
                  <c.icon className="size-5 shrink-0 text-primary-text" aria-hidden />
                  {t(`${c.chave}.titulo`)}
                </span>
                <span className="text-sm text-muted">{t(`${c.chave}.texto`)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </PageContainer>
  );
}
