'use client';

import type { Game, TournamentTemplate } from '@nova/schemas';
import { Badge, Card } from '@nova/ui';
import { Layers, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { FORMAT_INFO } from '../lib/formats';

interface TemplateCardProps {
  template: TournamentTemplate;
  games: Game[];
  actions: ReactNode;
}

/** Cartão de modelo de campeonato: jogo, modo, vagas e o caminho das fases. */
export function TemplateCard({ template, games, actions }: TemplateCardProps) {
  const game = games.find((g) => g.id === template.gameId);
  const mode = game?.modes.find((m) => m.id === template.gameModeId);
  const stages = template.payload.stages ?? [];
  return (
    <Card className="flex h-full flex-col gap-3" data-testid={`template-${template.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-text">{template.name}</h3>
          <p className="text-sm text-muted">
            <span aria-hidden>{game?.icon ?? '🎮'} </span>
            {game?.name ?? 'Jogo fora do catálogo'}
            {mode ? ` · ${mode.name}` : ''}
          </p>
        </div>
        <Badge tone={template.ownerId === null ? 'neutral' : 'accent'}>{template.ownerId === null ? 'Da plataforma' : 'Meu modelo'}</Badge>
      </div>
      {template.description && <p className="text-sm text-text">{template.description}</p>}
      <ul className="flex flex-col gap-1 text-sm text-muted">
        {template.payload.maxParticipants !== undefined && (
          <li className="flex items-center gap-2">
            <Users className="size-4 shrink-0" aria-hidden />
            {template.payload.maxParticipants} vagas
          </li>
        )}
        <li className="flex items-start gap-2">
          <Layers className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {stages.length === 0
              ? 'Sem fases definidas'
              : `${stages.length} ${stages.length === 1 ? 'fase' : 'fases'}: ${stages.map((s) => `${s.name} (${FORMAT_INFO[s.format].name})`).join(' → ')}`}
          </span>
        </li>
      </ul>
      <div className="mt-auto flex flex-wrap gap-2 pt-1">{actions}</div>
    </Card>
  );
}
