'use client';

import { Card, Skeleton } from '@nova/ui';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { isOrganizerUser, useSession } from '@/shared/session/useSession';
import { GameAccountsSection } from './GameAccountsSection';
import { OrganizerRequestSection } from './OrganizerRequestSection';
import { ProfileForm } from './ProfileForm';

/** `/minha-conta`: perfil, IDs de jogo e pedido para virar organizador. */
export function AccountPage() {
  const { user } = useSession();

  return (
    <PageContainer>
      <PageHeader title="Minha conta" description="Seus dados na Nova Arena e os IDs que você usa em cada jogo." />
      {!user ? (
        // O layout já garante a sessão; isto cobre só o instante entre sair da conta e o redirecionamento.
        <div className="grid gap-6 lg:grid-cols-2" role="status" aria-label="Carregando sua conta">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <Card className="min-w-0">
            <section aria-labelledby="conta-perfil" className="flex flex-col gap-4">
              <h2 id="conta-perfil" className="text-lg">
                Perfil
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
                    IDs de jogo
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    Os campeonatos pedem o seu ID no jogo para a inscrição. Ele não aparece no seu perfil público: só a organização dos campeonatos em que você se inscreve consegue ver.
                  </p>
                </div>
                <GameAccountsSection key={user.id} user={user} />
              </section>
            </Card>

            {!isOrganizerUser(user) && (
              <Card>
                <section aria-labelledby="conta-organizador" className="flex flex-col gap-4">
                  <h2 id="conta-organizador" className="text-lg">
                    Quero ser organizador
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
