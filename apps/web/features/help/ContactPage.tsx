'use client';

import { Button, Card, ErrorState, Skeleton } from '@nova/ui';
import { Flag, HelpCircle, Mail, Scale } from 'lucide-react';
import Link from 'next/link';
import { errorMessage } from '@/shared/api/client';
import { usePublicSiteSettings } from '@/shared/api/hooks/admin-settings';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';

const OUTROS_CAMINHOS = [
  { href: '/ajuda', icon: HelpCircle, titulo: 'Central de ajuda', texto: 'Inscrição, check-in, W.O., disputas e como organizar.' },
  { href: '/minha-conta/denuncias', icon: Flag, titulo: 'Denúncias', texto: 'Trapaça, ofensa ou conta falsa: denuncie pelo perfil ou pela partida e acompanhe aqui.' },
  { href: '/ajuda#contestar', icon: Scale, titulo: 'Resultado errado', texto: 'Conteste pela própria partida: a organização do campeonato analisa primeiro.' },
];

/**
 * Contato com o suporte (issue #110). O e-mail vem das configurações do site (`GET /site/settings`), que o
 * Super Admin edita em Configurações — nada fica fixo no código.
 */
export function ContactPage() {
  const settings = usePublicSiteSettings();

  return (
    <PageContainer narrow>
      <PageHeader title="Fale com a gente" description="Problema com a conta, dúvida sobre a plataforma ou sugestão: o suporte responde por e-mail em dias úteis." />

      <Card className="flex flex-col gap-4">
        <h2 className="flex items-center gap-2 text-lg">
          <Mail className="size-5 text-primary-text" aria-hidden />
          E-mail do suporte
        </h2>
        {settings.isPending ? (
          <div className="flex flex-col gap-2" role="status" aria-label="Carregando o contato do suporte">
            <Skeleton className="h-6 w-64 max-w-full" />
            <Skeleton className="h-11 w-48" />
          </div>
        ) : settings.isError ? (
          <ErrorState title="Não foi possível carregar o contato" description={errorMessage(settings.error)} onRetry={() => void settings.refetch()} />
        ) : (
          <>
            <p className="break-all font-display text-xl font-bold text-text" data-testid="support-email">
              {settings.data.supportEmail}
            </p>
            <div>
              <Button asChild>
                <a href={`mailto:${settings.data.supportEmail}?subject=${encodeURIComponent('Suporte Nova Arena')}`}>
                  <Mail className="size-4" aria-hidden />
                  Escrever para o suporte
                </a>
              </Button>
            </div>
          </>
        )}
        <div className="flex flex-col gap-1 text-sm">
          <h3 className="font-semibold">Para a gente resolver mais rápido, conte:</h3>
          <ul className="list-disc pl-5 text-muted">
            <li>o seu nick na Nova Arena e o e-mail da conta;</li>
            <li>o link do campeonato ou da partida, se for o caso;</li>
            <li>o que aconteceu e, se puder, um print da tela.</li>
          </ul>
          <p className="text-muted">Nunca pedimos a sua senha. Desconfie de quem pedir.</p>
        </div>
      </Card>

      <section aria-labelledby="outros-caminhos" className="flex flex-col gap-3">
        <h2 id="outros-caminhos" className="text-lg">
          Talvez seja mais rápido por aqui
        </h2>
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {OUTROS_CAMINHOS.map((c) => (
            <li key={c.href}>
              <Link href={c.href} className="flex h-full min-h-11 flex-col gap-1 rounded-lg border border-border bg-surface p-4 shadow-sm transition-shadow hover:shadow-md">
                <span className="flex items-center gap-2 font-semibold text-text">
                  <c.icon className="size-5 shrink-0 text-primary-text" aria-hidden />
                  {c.titulo}
                </span>
                <span className="text-sm text-muted">{c.texto}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </PageContainer>
  );
}
