'use client';

import { Card, Skeleton } from '@nova/ui';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { isAdminUser, useSession } from '@/shared/session/useSession';
import { EmailStatus } from '../EmailStatus';
import { TwoFactorSection } from './TwoFactorSection';

/** `/minha-conta/seguranca`: e-mail da conta e verificação em duas etapas (configurar, códigos de recuperação, desligar). */
export function SecurityPage() {
  const { user } = useSession();

  return (
    <PageContainer>
      <PageHeader title="Segurança" description="Como a sua conta está protegida." />
      {!user ? (
        <div className="flex max-w-3xl flex-col gap-6" role="status" aria-label="Carregando">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <div className="flex max-w-3xl flex-col gap-6">
          <Card>
            <section aria-labelledby="seguranca-email" className="flex flex-col gap-3">
              <h2 id="seguranca-email" className="text-lg">
                E-mail da conta
              </h2>
              <EmailStatus email={user.email} verified={user.emailVerified} />
            </section>
          </Card>
          <Card>
            <TwoFactorSection isAdmin={isAdminUser(user)} />
          </Card>
        </div>
      )}
    </PageContainer>
  );
}
