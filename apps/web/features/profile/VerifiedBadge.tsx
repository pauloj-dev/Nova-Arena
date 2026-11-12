import { Badge, cn } from '@nova/ui';
import { BadgeCheck } from 'lucide-react';

/** Selo de organizador verificado (PRD §15.1, "confiança visível"): sempre ícone + texto. */
export function VerifiedBadge({ compact = false, className }: { compact?: boolean; className?: string }) {
  if (compact) {
    return (
      <span className={cn('inline-flex items-center gap-1 text-xs font-semibold text-primary-text', className)}>
        <BadgeCheck className="size-4 shrink-0" aria-hidden />
        Verificado
      </span>
    );
  }
  return (
    <Badge tone="primary" className={className} icon={<BadgeCheck className="size-3.5" aria-hidden />}>
      Organizador verificado
    </Badge>
  );
}
