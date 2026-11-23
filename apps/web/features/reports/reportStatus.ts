import type { Report } from '@nova/schemas';
import type { Status } from '@nova/ui';
import { getT } from '@/shared/i18n/core';
import { messages } from './messages';

const PILL: Record<Report['status'], Status> = {
  OPEN: 'OPEN',
  IN_REVIEW: 'IN_REVIEW',
  ACTIONED: 'RESOLVED',
  DISMISSED: 'COMPLETED',
};

/** Como cada status de denúncia aparece no `StatusPill` (ícone + texto). */
export function reportStatus(status: Report['status']): { status: Status; label: string; help: string } {
  const t = getT(messages, 'reportStatus');
  return { status: PILL[status], label: t(`${status}.label`), help: t(`${status}.help`) };
}

/** Rótulo do tipo do alvo da denúncia. */
export function reportTargetLabel(targetType: Report['targetType']): string {
  return getT(messages, 'reportTarget')(targetType);
}
