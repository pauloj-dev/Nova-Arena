import { Badge, cn } from '@nova/ui';
import { BadgeCheck } from 'lucide-react';
import { getT } from '@/shared/i18n/core';
import { messages } from './messages';

/** Selo de organizador verificado (PRD §15.1, "confiança visível"): sempre ícone + texto. */
export function VerifiedBadge({ compact = false, className }: { compact?: boolean; className?: string }) {
  const t = getT(messages, 'VerifiedBadge');
  if (compact) {
    return (
      <span className={cn('inline-flex items-center gap-1 text-xs font-semibold text-primary-text', className)}>
        <BadgeCheck className="size-4 shrink-0" aria-hidden />
        {t('verificado')}
      </span>
    );
  }
  return (
    <Badge tone="primary" className={className} icon={<BadgeCheck className="size-3.5" aria-hidden />}>
      {t('organizadorVerificado')}
    </Badge>
  );
}
