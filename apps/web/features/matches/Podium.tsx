import type { Podium as PodiumData } from '@nova/schemas';
import { Avatar, cn } from '@nova/ui';
import { Medal, Trophy } from 'lucide-react';
import { formatDate } from '@/shared/lib/datetime';

const PLACES: Record<number, { title: string; icon: typeof Trophy; medal: string; border: string; order: string }> = {
  1: { title: 'Campeão', icon: Trophy, medal: 'bg-gold text-gold-text', border: 'border-t-gold', order: 'md:order-2 md:-mt-4' },
  2: { title: 'Vice-campeão', icon: Medal, medal: 'bg-silver text-gold-text', border: 'border-t-silver', order: 'md:order-1' },
  3: { title: '3º lugar', icon: Medal, medal: 'bg-bronze text-white', border: 'border-t-bronze', order: 'md:order-3' },
};

export interface PodiumProps {
  podium: PodiumData;
  /** Inscrição de quem está vendo, para marcar "Você". */
  highlightRegistrationId?: string | null;
  className?: string;
}

/** Pódio do campeonato encerrado: ouro, prata e bronze, sempre com o lugar por escrito. */
export function Podium({ podium, highlightRegistrationId, className }: PodiumProps) {
  const places = [...podium.places].sort((a, b) => a.place - b.place);
  if (places.length === 0) return null;
  return (
    <section className={cn('flex flex-col gap-3', className)} aria-labelledby="podium-title" data-testid="podium">
      <div>
        <h3 id="podium-title" className="text-lg">
          Pódio
        </h3>
        <p className="text-sm text-muted">Campeonato encerrado em {formatDate(podium.finishedAt)}.</p>
      </div>
      <ol className="grid grid-cols-1 gap-3 md:grid-cols-3 md:items-end md:pt-4">
        {places.map((p) => {
          const style = PLACES[p.place] ?? PLACES[3];
          if (!style) return null;
          const Icon = style.icon;
          const mine = p.registrationId === highlightRegistrationId;
          return (
            <li key={p.registrationId} className={cn('flex items-center gap-3 rounded-lg border border-t-4 border-border bg-surface p-4 shadow-sm md:flex-col md:text-center', style.border, style.order, p.place === 1 && 'md:py-6')} data-place={p.place}>
              <span className={cn('flex size-12 shrink-0 items-center justify-center rounded-full', style.medal)} aria-hidden>
                <Icon className="size-6" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col md:items-center">
                <span className="tabular text-xs text-muted">
                  {p.place}º lugar{p.place <= 2 ? ` · ${style.title}` : ''}
                </span>
                <span className="flex min-w-0 items-center gap-2">
                  <Avatar name={p.name} src={p.logoUrl} size="sm" className="shrink-0" />
                  <span className="truncate font-display text-base font-bold">{p.name}</span>
                </span>
                {p.tag && <span className="tabular text-xs text-muted">[{p.tag}]</span>}
                {mine && <span className="text-xs font-semibold text-accent-soft-text">Você</span>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
