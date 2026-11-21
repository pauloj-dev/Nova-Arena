'use client';

import type { Game, GameMode, StageInput } from '@nova/schemas';
import { Badge, Button, Card, EmptyState, Modal, Select } from '@nova/ui';
import { AlertTriangle, CheckCircle2, Clock, Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { sharedMessages } from '@/shared/i18n/messages';
import { useT } from '@/shared/i18n/react';
import { NumberField } from '../components/NumberField';
import { BR_DROP_MINUTES, DUEL_GAME_MINUTES, formatDuration, suggestFormats, type FormatSuggestion } from '../lib/formatAssistant';
import { FORMAT_INFO } from '../lib/formats';
import { messages } from './messages';

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
  { value: '60', key: 'tempoUmaHora' },
  { value: '90', key: 'tempoUmaHoraEMeia' },
  { value: '120', key: 'tempoDuasHoras' },
  { value: '180', key: 'tempoTresHoras' },
  { value: '240', key: 'tempoQuatroHoras' },
  { value: '360', key: 'tempoSeisHoras' },
  { value: '480', key: 'tempoOitoHoras' },
  { value: '960', key: 'tempoDoisDias' },
] as const;

function SuggestionCard({ suggestion, onUse }: { suggestion: FormatSuggestion; onUse: () => void }) {
  const t = useT(messages, 'FormatAssistant');
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
              {t('cabeNoTempo')}
            </Badge>
          ) : (
            <Badge tone="warning" icon={<AlertTriangle className="size-3.5" aria-hidden />}>
              {t('passaDoTempo')}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted">{suggestion.summary}</p>
        <p className="flex items-center gap-1.5 text-sm font-semibold text-text">
          <Clock className="size-4 text-muted" aria-hidden />
          {t('cercaDe', { duracao: formatDuration(suggestion.estimatedMinutes), count: suggestion.rounds })}
        </p>
        <p className="text-xs text-muted">{t('fases', { lista: suggestion.stages.map((s) => t('faseFormato', { nome: s.name, formato: FORMAT_INFO[s.format].name })).join(' → ') })}</p>
        <div className="grid grid-cols-1 gap-2 text-sm xs:grid-cols-2">
          <div>
            <p className="text-xs font-semibold text-text">{t('vantagens')}</p>
            <ul className="list-disc pl-4 text-muted">
              {suggestion.pros.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold text-text">{t('cuidados')}</p>
            <ul className="list-disc pl-4 text-muted">
              {suggestion.cons.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-auto pt-1">
          <Button size="sm" variant={suggestion.fits ? 'primary' : 'secondary'} onClick={onUse} aria-label={t('usarFormatoAria', { titulo: suggestion.title })}>
            {t('usarFormato')}
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
  const t = useT(messages, 'FormatAssistant');
  const common = useT(sharedMessages, 'comum');
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
          {t('sugerirFormato')}
        </Button>
      </div>
      <Modal open={open && pending === null} onOpenChange={setOpen} size="lg" title={t('sugerirFormato')} description={t('descricao', { br: isBr ? 'sim' : 'nao', jogo: game.name, modo: mode.name })}>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 xs:grid-cols-2">
            <NumberField label={isBr ? t('equipesInscritas') : t('inscritos')} value={entrants} onChange={setEntrants} min={2} max={1024} hint={t('vagasHint', { count: maxParticipants })} />
            <Select label={t('tempoDisponivel')} value={minutes} onChange={(e) => setMinutes(e.target.value)} options={TIME_OPTIONS.map((o) => ({ value: o.value, label: t(o.key) }))} />
          </div>
          <p className="text-xs text-muted">
            {t('estimativa', { br: isBr ? 'sim' : 'nao', minutos: isBr ? BR_DROP_MINUTES : DUEL_GAME_MINUTES })}
          </p>
          {suggestions.length === 0 ? (
            <EmptyState icon={<Wand2 className="size-7" />} title={t('nenhumFormatoTitulo')} description={t('nenhumFormatoDescricao')} />
          ) : (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-label={t('formatosSugeridos')} aria-live="polite">
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
        title={t('substituirTitulo')}
        description={pending ? t('substituirDescricao', { titulo: pending.title }) : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPending(null)}>
              {common('cancelar')}
            </Button>
            <Button onClick={() => pending && apply(pending)}>{t('substituirFases')}</Button>
          </>
        }
      />
    </>
  );
}
