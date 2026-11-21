'use client';

import type { Role } from '@nova/schemas';
import { Button, EmptyState, Skeleton } from '@nova/ui';
import { KeyRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { sharedMessages } from '../i18n/messages';
import { useT } from '../i18n/react';
import { useSession } from '../session/useSession';
import { Forbidden } from './Forbidden';

interface RequireRoleProps {
  /** Papéis aceitos. Vazio = basta estar logado. */
  roles?: Role[];
  /** Exige verificação em duas etapas ativa (área Admin, RNF-08). */
  require2FA?: boolean;
  areaName?: string;
  children: ReactNode;
}

/**
 * Proteção de rota no cliente. Só esconde a tela: a checagem que vale é a da API,
 * e a partir de B1 o `proxy.ts` também redireciona na borda.
 */
export function RequireRole({ roles = [], require2FA = false, areaName, children }: RequireRoleProps) {
  const { user, isLoading } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const t = useT(sharedMessages);

  useEffect(() => {
    if (!isLoading && !user) router.replace(`/entrar?next=${encodeURIComponent(pathname)}`);
  }, [isLoading, user, router, pathname]);

  if (isLoading || !user) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6" role="status" aria-label={t('comum.carregando')}>
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (roles.length > 0 && !roles.some((r) => user.roles.includes(r))) return <Forbidden area={areaName} />;
  if (require2FA && !user.twoFactorEnabled) {
    return (
      <main id="conteudo" className="mx-auto flex min-h-[60dvh] max-w-xl items-center px-4 py-10">
        <EmptyState
          className="w-full"
          icon={<KeyRound className="size-7" />}
          title={t('RequireRole.titulo2fa')}
          description={t('RequireRole.descricao2fa')}
          action={
            <Button asChild>
              <Link href="/minha-conta/seguranca">{t('RequireRole.configurarAgora')}</Link>
            </Button>
          }
        />
      </main>
    );
  }
  return <>{children}</>;
}
