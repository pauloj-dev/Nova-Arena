'use client';

import { Button, EmptyState } from '@nova/ui';
import { PowerOff } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageContainer } from '../layout/AreaShell';
import { useFlags } from './useFlag';

interface FlagGateProps {
  flag: string;
  /** O que mostrar com o recurso desligado. Padrão: aviso de página indisponível. */
  fallback?: ReactNode;
  children: ReactNode;
}

/** Mostra o conteúdo só com o recurso ligado nas configurações do site (feature flag). */
export function FlagGate({ flag, fallback, children }: FlagGateProps) {
  const { flags, isLoading } = useFlags();
  // Enquanto a resposta não chega valem os padrões, para a página não piscar "indisponível".
  if (isLoading || flags[flag]) return <>{children}</>;
  return (
    <>
      {fallback ?? (
        <PageContainer narrow>
          <EmptyState
            icon={<PowerOff className="size-7" />}
            title="Página indisponível no momento"
            description="Este recurso está desligado pela administração da Nova Arena."
            action={
              <Button asChild>
                <Link href="/">Voltar para o início</Link>
              </Button>
            }
          />
        </PageContainer>
      )}
    </>
  );
}
