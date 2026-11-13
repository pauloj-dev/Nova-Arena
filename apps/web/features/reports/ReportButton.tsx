'use client';

import { Button, cn } from '@nova/ui';
import { Flag } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useSession } from '@/shared/session/useSession';
import { ReportDialog } from './ReportDialog';

export interface ReportButtonProps {
  targetType: 'USER' | 'TEAM' | 'MATCH' | 'RESULT';
  targetId: string;
  /** Nome do que está sendo denunciado, para o título do formulário. */
  targetLabel: string;
  /** `icon`: só o ícone (em cards); `button`: ícone + "Denunciar". */
  variant?: 'icon' | 'button';
  className?: string;
}

/** Botão "Denunciar": abre o formulário (motivo, descrição e anexo). Visitante é levado ao login e volta para a mesma página. */
export function ReportButton({ targetType, targetId, targetLabel, variant = 'button', className }: ReportButtonProps) {
  const { user, isLoading } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  function start() {
    if (isLoading) return;
    if (!user) {
      router.push(`/entrar?next=${encodeURIComponent(pathname)}`);
      return;
    }
    setOpen(true);
  }

  return (
    <>
      {variant === 'icon' ? (
        <button
          type="button"
          onClick={start}
          aria-label={`Denunciar ${targetLabel}`}
          title="Denunciar"
          className={cn('flex size-11 shrink-0 items-center justify-center rounded-md text-muted hover:bg-neutral-soft hover:text-text', className)}
        >
          <Flag className="size-4" aria-hidden />
        </button>
      ) : (
        <Button variant="ghost" size="sm" className={className} iconLeft={<Flag className="size-4" aria-hidden />} onClick={start} aria-label={`Denunciar ${targetLabel}`}>
          Denunciar
        </Button>
      )}
      {/* Montado só quando aberto: cada abertura começa com o formulário limpo. */}
      {open && <ReportDialog targetType={targetType} targetId={targetId} targetLabel={targetLabel} onClose={() => setOpen(false)} />}
    </>
  );
}
