'use client';

import type { Game, TournamentTemplate } from '@nova/schemas';
import { Badge, Card } from '@nova/ui';
import { Layers, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { useT } from '@/shared/i18n/react';
import { FORMAT_INFO } from '../lib/formats';
import { messages } from '../messages';

interface TemplateCardProps {
  template: TournamentTemplate;
  games: Game[];
  actions: ReactNode;
}

/** Cartão de modelo de campeonato: jogo, modo, vagas e o caminho das fases. */
export function TemplateCard({ template, games, actions }: TemplateCardProps) {
  const t = useT(messages, 'TemplateCard');
  const game = games.find((g) => g.id === template.gameId);
  const mode = game?.modes.find((m) => m.id === template.gameModeId);
  const gameIcon = game?.icon ?? '🎮';
  const stages = template.payload.stages ?? [];
  const stagePath = stages.map((s) => t('fase', { nome: s.name, formato: FORMAT_INFO[s.format].name })).join(' → ');
  return (
    <Card className="flex h-full flex-col gap-3" data-testid={`template-${template.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-text">{template.name}</h3>
          <p className="text-sm text-muted">
            <span aria-hidden>{gameIcon} </span>
            {game?.name ?? t('jogoForaDoCatalogo')}
            {mode ? ` · ${mode.name}` : ''}
          </p>
        </div>
        <Badge tone={template.ownerId === null ? 'neutral' : 'accent'}>{template.ownerId === null ? t('daPlataforma') : t('meuModelo')}</Badge>
      </div>
      {template.description && <p className="text-sm text-text">{template.description}</p>}
      <ul className="flex flex-col gap-1 text-sm text-muted">
        {template.payload.maxParticipants !== undefined && (
          <li className="flex items-center gap-2">
            <Users className="size-4 shrink-0" aria-hidden />
            {t('vagas', { vagas: String(template.payload.maxParticipants) })}
          </li>
        )}
        <li className="flex items-start gap-2">
          <Layers className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {stages.length === 0 ? t('semFases') : t('fases', { count: stages.length, lista: stagePath })}
          </span>
        </li>
      </ul>
      <div className="mt-auto flex flex-wrap gap-2 pt-1">{actions}</div>
    </Card>
  );
}
