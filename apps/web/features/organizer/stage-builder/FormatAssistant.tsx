'use client';

import type { Game, GameMode, StageInput } from '@nova/schemas';
import { Badge, Button, Card, EmptyState, Modal, Select } from '@nova/ui';
import { AlertTriangle, CheckCircle2, Clock, Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { NumberField } from '../components/NumberField';
import { BR_DROP_MINUTES, DUEL_GAME_MINUTES, formatDuration, suggestFormats, type FormatSuggestion } from '../lib/formatAssistant';
import { FORMAT_INFO } from '../lib/formats';

export interface FormatAssistantProps {
  game: Game | null;
  mode: GameMode | null;
  userId: string | null;
  /** Vagas do campeonato: ponto de partida para "inscritos". */
  maxParticipants: number;
  /** Já há fases montadas: aplicar uma sugestão pede confirmação, porque substitui tudo. */
  hasStages: boolean;
  onApply: (stages: StageInput[]) => void;
}

const TIME_OPTIONS = [
  { value: '60', label: '1 hora' },
  { value: '90', label: '1 h 30 min' },
  { value: '120', label: '2 horas' },
  { value: '180', label: '3 horas' },
  { value: '240', label: '4 horas' },
  { value: '360', label: '6 horas' },
  { value: '480', label: '8 horas (um dia)' },
  { value: '960', label: '2 dias (8 h por dia)' },
];

function SuggestionCard({ suggestion, onUse }: { suggestion: FormatSuggestion; onUse: () => void }) {
  const titleId = `sugestao-${suggestion.id}`;
  return (
    <li>
      <Card padding="sm" className="flex h-full flex-col gap-2" data-testid="format-suggestion">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 id={titleId} className="text-base">
            {suggestion.title}
          </h3>
          {suggestion.fits ? (
            <Badge tone="primary" icon={<CheckCircle2 className="size-3.5" aria-hidden />}>
              Cabe no tempo
            </Badge>
          ) : (
            <Badge tone="warning" icon={<AlertTriangle className="size-3.5" aria-hidden />}>
              Passa do tempo
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted">{suggestion.summary}</p>
        <p className="flex items-center gap-1.5 text-sm font-semibold text-text">
          <Clock className="size-4 text-muted" aria-hidden />
          Cerca de {formatDuration(suggestion.estimatedMinutes)} · {suggestion.rounds} {suggestion.rounds === 1 ? 'rodada' : 'rodadas'}
        </p>
        <p className="text-xs text-muted">Fases: {suggestion.stages.map((s) => `${s.name} (${FORMAT_INFO[s.format].name})`).join(' → ')}</p>
        <div className="grid grid-cols-1 gap-2 text-sm xs:grid-cols-2">
          <div>
            <p className="text-xs font-semibold text-text">Vantagens</p>
            <ul className="list-disc pl-4 text-muted">
              {suggestion.pros.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold text-text">Cuidados</p>
            <ul className="list-disc pl-4 text-muted">
              {suggestion.cons.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-auto pt-1">
          <Button size="sm" variant={suggestion.fits ? 'primary' : 'secondary'} onClick={onUse} aria-label={`Usar este formato: ${suggestion.title}`}>
            Usar este formato
          </Button>
        </div>
      </Card>
    </li>
  );
}

/**
 * "Sugerir formato" (issue 125): pergunta inscritos e tempo disponível e mostra formatos prontos, com a duração
 * estimada. Aplicar substitui as fases do passo (com confirmação quando já existem fases).
 */
export function FormatAssistant({ game, mode, userId, maxParticipants, hasStages, onApply }: FormatAssistantProps) {
  const [open, setOpen] = useState(false);
  const [entrants, setEntrants] = useState(maxParticipants);
  const [minutes, setMinutes] = useState('180');
  const [pending, setPending] = useState<FormatSuggestion | null>(null);
  const suggestions = useMemo(() => (open ? suggestFormats({ entrants, availableMinutes: Number(minutes), game, mode, userId }) : []), [open, entrants, minutes, game, mode, userId]);

  if (!game || !mode) return null;

  function start() {
    setEntrants(maxParticipants);
    setOpen(true);
  }
  function apply(s: FormatSuggestion) {
    onApply(s.stages);
    setPending(null);
    setOpen(false);
  }

  const isBr = mode.matchType === 'BATTLE_ROYALE';
  return (
    <>
      <div>
        <Button variant="secondary" iconLeft={<Wand2 className="size-4" aria-hidden />} onClick={start}>
          Sugerir formato
        </Button>
      </div>
      <Modal open={open && pending === null} onOpenChange={setOpen} size="lg" title="Sugerir formato" description={`Diga quantos ${isBr ? 'equipes' : 'participantes'} e quanto tempo você tem: sugerimos formatos prontos para ${game.name} · ${mode.name}.`}>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 xs:grid-cols-2">
            <NumberField label={isBr ? 'Equipes inscritas' : 'Inscritos'} value={entrants} onChange={setEntrants} min={2} max={1024} hint={`As vagas do campeonato são ${maxParticipants}.`} />
            <Select label="Tempo disponível" value={minutes} onChange={(e) => setMinutes(e.target.value)} options={TIME_OPTIONS} />
          </div>
          <p className="text-xs text-muted">
            Estimativa com as partidas de uma mesma rodada acontecendo ao mesmo tempo, {isBr ? `${BR_DROP_MINUTES} min por queda` : `${DUEL_GAME_MINUTES} min por jogo`} e 5 min entre rodadas.
          </p>
          {suggestions.length === 0 ? (
            <EmptyState icon={<Wand2 className="size-7" />} title="Nenhum formato sugerido" description="Não encontramos um formato válido para esse número de inscritos neste modo. Monte as fases do seu jeito." />
          ) : (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-label="Formatos sugeridos" aria-live="polite">
              {suggestions.map((s) => (
                <SuggestionCard key={s.id} suggestion={s} onUse={() => (hasStages ? setPending(s) : apply(s))} />
              ))}
            </ul>
          )}
        </div>
      </Modal>
      <Modal
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
        size="sm"
        title="Substituir as fases?"
        description={pending ? `As fases montadas até aqui serão trocadas pelo formato "${pending.title}".` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPending(null)}>
              Cancelar
            </Button>
            <Button onClick={() => pending && apply(pending)}>Substituir fases</Button>
          </>
        }
      />
    </>
  );
}
