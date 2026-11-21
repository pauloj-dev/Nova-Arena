'use client';

import { Lightbulb, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useT } from '@/shared/i18n/react';
import { useSession } from '@/shared/session/useSession';
import { messages } from '../messages';
import { useOnboardingFlag } from './storage';

/**
 * Dica contextual curta, mostrada até a pessoa dispensar (issue #62). A preferência fica neste aparelho.
 * No servidor e antes de hidratar a dica não aparece, para não piscar para quem já dispensou.
 */
export function Tip({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const t = useT(messages, 'Tip');
  const { user } = useSession();
  const [dismissed, dismiss] = useOnboardingFlag(`dica:${id}`, user?.id, true);
  if (dismissed) return null;
  return (
    <aside className="flex items-start gap-3 rounded-lg border border-border bg-info-soft p-3 text-info-soft-text" aria-label={t('dica', { titulo: title })} data-testid={`dica-${id}`}>
      <Lightbulb className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold">{title}</p>
        <div>{children}</div>
      </div>
      <button
        type="button"
        onClick={() => dismiss()}
        aria-label={t('dispensar', { titulo: title })}
        className="flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-surface focus-visible:outline-2 focus-visible:outline-accent md:size-8"
      >
        <X className="size-4" aria-hidden />
      </button>
    </aside>
  );
}
