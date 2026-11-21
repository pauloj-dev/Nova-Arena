'use client';

import { Card, Skeleton } from '@nova/ui';
import { Suspense } from 'react';
import { useT } from '@/shared/i18n/react';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { isAdminUser, useSession } from '@/shared/session/useSession';
import { EmailStatus } from '../EmailStatus';
import { messages } from '../messages';
import { ChangeEmailForm } from './ChangeEmailForm';
import { ChangePasswordSection } from './ChangePasswordSection';
import { DevicesSection } from './DevicesSection';
import { LoginMethodsSection } from './LoginMethodsSection';
import { TwoFactorSection } from './TwoFactorSection';

/** `/minha-conta/seguranca`: e-mail da conta (e troca), jeitos de entrar, senha, aparelhos conectados e verificação em duas etapas (configurar, códigos de recuperação, desligar). */
export function SecurityPage() {
  const { user } = useSession();
  const t = useT(messages, 'SecurityPage');

  return (
    <PageContainer>
      <PageHeader title={t('titulo')} description={t('descricao')} />
      {!user ? (
        <div className="flex max-w-3xl flex-col gap-6" role="status" aria-label={t('carregando')}>
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <div className="flex max-w-3xl flex-col gap-6">
          <Card>
            <section aria-labelledby="seguranca-email" className="flex flex-col gap-3">
              <h2 id="seguranca-email" className="text-lg">
                {t('emailDaConta')}
              </h2>
              <EmailStatus email={user.email} verified={user.emailVerified} />
              <ChangeEmailForm />
            </section>
          </Card>
          <Card>
            {/* `useSearchParams` (retorno do provedor) precisa de Suspense. */}
            <Suspense fallback={<Skeleton className="h-32 w-full" />}>
              <LoginMethodsSection />
            </Suspense>
          </Card>
          <Card>
            <ChangePasswordSection />
          </Card>
          <Card>
            <DevicesSection />
          </Card>
          <Card>
            <TwoFactorSection isAdmin={isAdminUser(user)} />
          </Card>
        </div>
      )}
    </PageContainer>
  );
}
