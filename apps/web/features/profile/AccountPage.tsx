'use client';

import { Card, Skeleton } from '@nova/ui';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { useT } from '@/shared/i18n/react';
import { isOrganizerUser, useSession } from '@/shared/session/useSession';
import { GameAccountsSection } from './GameAccountsSection';
import { OrganizerRequestSection } from './OrganizerRequestSection';
import { messages } from './messages';
import { ProfileForm } from './ProfileForm';

/** `/minha-conta`: perfil, IDs de jogo e pedido para virar organizador. */
export function AccountPage() {
  const { user } = useSession();
  const t = useT(messages, 'AccountPage');

  return (
    <PageContainer>
      <PageHeader title={t('titulo')} description={t('descricao')} />
      {!user ? (
        // O layout já garante a sessão; isto cobre só o instante entre sair da conta e o redirecionamento.
        <div className="grid gap-6 lg:grid-cols-2" role="status" aria-label={t('carregando')}>
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <Card className="min-w-0">
            <section aria-labelledby="conta-perfil" className="flex flex-col gap-4">
              <h2 id="conta-perfil" className="text-lg">
                {t('perfil')}
              </h2>
              {/* A chave refaz o formulário ao trocar de conta (seletor "Entrar como" do protótipo). */}
              <ProfileForm key={user.id} user={user} />
            </section>
          </Card>

          <div className="flex min-w-0 flex-col gap-6">
            <Card>
              <section aria-labelledby="conta-ids" className="flex flex-col gap-4">
                <div>
                  <h2 id="conta-ids" className="text-lg">
                    {t('idsDeJogo')}
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    {t('idsDescricao')}
                  </p>
                </div>
                <GameAccountsSection key={user.id} user={user} />
              </section>
            </Card>

            {!isOrganizerUser(user) && (
              <Card>
                <section aria-labelledby="conta-organizador" className="flex flex-col gap-4">
                  <h2 id="conta-organizador" className="text-lg">
                    {t('queroSerOrganizador')}
                  </h2>
                  <OrganizerRequestSection key={user.id} />
                </section>
              </Card>
            )}
          </div>
        </div>
      )}
    </PageContainer>
  );
}
