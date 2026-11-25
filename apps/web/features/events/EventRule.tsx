'use client';

/** A regra de participação do evento em palavras simples, sempre com ícone + texto (ADR-0005). */
import type { Event, EventParticipationRule, TournamentEventRef } from '@nova/schemas';
import { Badge, Card, cn } from '@nova/ui';
import { CalendarHeart, UserCheck, Users } from 'lucide-react';
import Link from 'next/link';
import { useT } from '@/shared/i18n/react';
import { messages } from './messages';

const RULE_ICON = { SINGLE: UserCheck, MULTIPLE: Users } as const;

/** Frase completa ("Cada jogador pode participar de um só campeonato deste evento."). Em linha: cabe dentro de um parágrafo. */
export function EventRuleNote({ rule, className }: { rule: EventParticipationRule; className?: string }) {
  const t = useT(messages, 'regra');
  const Icon = RULE_ICON[rule];
  return (
    <span className={cn('flex items-start gap-2 text-sm text-text', className)}>
      <Icon className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
      <span>{t(rule)}</span>
    </span>
  );
}

/** Selo curto ("Um campeonato por jogador"). */
export function EventRuleBadge({ rule }: { rule: EventParticipationRule }) {
  const t = useT(messages, 'regra.curta');
  const Icon = RULE_ICON[rule];
  return (
    <Badge tone={rule === 'SINGLE' ? 'warning' : 'neutral'} icon={<Icon className="size-3.5" aria-hidden />}>
      {t(rule)}
    </Badge>
  );
}

/** Na página do campeonato: de que evento ele faz parte e a regra de participação. */
export function TournamentEventNote({ event }: { event: TournamentEventRef }) {
  const t = useT(messages, 'TournamentEventNote');
  const partOf = t.rich('parteDe', {
    nome: event.name,
    link: (chunks) => (
      <Link href={`/e/${event.slug}`} className="font-semibold text-primary-text underline-offset-2 [overflow-wrap:anywhere] hover:underline">
        {chunks}
      </Link>
    ),
  });
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm" data-testid="evento-do-campeonato">
      <p className="flex items-start gap-2 text-text">
        <CalendarHeart className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
        <span>{partOf}</span>
      </p>
      <EventRuleNote rule={event.participationRule} />
    </div>
  );
}

/** Card de evento (lista do organizador). O card inteiro é um link. */
export function EventCard({ event, href }: { event: Event; href: string }) {
  const t = useT(messages, 'EventCard');
  return (
    <Card interactive className="relative flex h-full flex-col gap-2">
      <p className="flex items-center gap-2 text-sm text-muted">
        <CalendarHeart className="size-4 text-accent" aria-hidden />
        {t('campeonatos', { count: event.tournamentCount })}
      </p>
      <h2 className="text-base">
        <Link href={href} className="text-text underline-offset-2 [overflow-wrap:anywhere] after:absolute after:inset-0 hover:underline">
          {event.name}
        </Link>
      </h2>
      <div>
        <EventRuleBadge rule={event.participationRule} />
      </div>
    </Card>
  );
}
