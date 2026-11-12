'use client';

import { Badge, Card, Skeleton } from '@nova/ui';
import { Clock, ShieldCheck, ShieldOff } from 'lucide-react';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { isAdminUser, useSession } from '@/shared/session/useSession';
import { EmailStatus } from './EmailStatus';

/** `/minha-conta/seguranca`: estado da verificação em duas etapas. A configuração do 2FA entra em outra fase. */
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
            <section aria-labelledby="seguranca-2fa" className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="seguranca-2fa" className="text-lg">
                  Verificação em duas etapas
                </h2>
                {user.twoFactorEnabled ? (
                  <Badge tone="primary" icon={<ShieldCheck className="size-3.5" aria-hidden />}>
                    Ativa
                  </Badge>
                ) : (
                  <Badge tone="neutral" icon={<ShieldOff className="size-3.5" aria-hidden />}>
                    Inativa
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted">
                Com a verificação em duas etapas, além da senha você informa um código de 6 dígitos gerado por um aplicativo autenticador no seu celular. Assim, mesmo que alguém descubra a sua senha, não consegue entrar
                na conta.
              </p>
              <p className="text-sm text-muted">Ela é obrigatória para administradores e opcional para as demais contas.</p>
              <div className="flex flex-col gap-2 rounded-md bg-info-soft px-3 py-3 text-sm text-info-soft-text">
                <Badge tone="info" className="self-start border border-info" icon={<Clock className="size-3.5" aria-hidden />}>
                  Em breve
                </Badge>
                <p>
                  {user.twoFactorEnabled
                    ? 'Trocar de aplicativo autenticador ou desativar a verificação ainda não é possível por aqui. Essa configuração chega em uma próxima fase da Nova Arena.'
                    : 'Ativar a verificação em duas etapas ainda não é possível por aqui. Essa configuração chega em uma próxima fase da Nova Arena.'}
                </p>
                {isAdminUser(user) && !user.twoFactorEnabled && <p>Como a área de administração exige a verificação ativa, ela continua bloqueada para a sua conta até a configuração ficar disponível.</p>}
              </div>
            </section>
          </Card>
        </div>
      )}
    </PageContainer>
  );
}
