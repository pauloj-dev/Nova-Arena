'use client';

import type { OrganizerTournamentDetail } from '@nova/schemas';
import { Button, ErrorState, Modal, Select, Skeleton, useToast } from '@nova/ui';
import { Trophy } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useFinishTournament, usePodiumSuggestion, type PodiumSuggestion } from '@/shared/api/hooks/competition';
import { useT } from '@/shared/i18n/react';
import { messages } from './messages';

const PLACES = [
  { key: 'first', label: 'lugarPrimeiro' },
  { key: 'second', label: 'lugarSegundo' },
  { key: 'third', label: 'lugarTerceiro' },
] as const;
type PlaceKey = (typeof PLACES)[number]['key'];

function PodiumForm({ tournament, suggestion, onClose, onFinished }: { tournament: OrganizerTournamentDetail; suggestion: PodiumSuggestion; onClose: () => void; onFinished?: () => void }) {
  const finish = useFinishTournament(tournament.id);
  const { success, error } = useToast();
  const t = useT(messages, 'FinishDialog');
  const [picks, setPicks] = useState<Record<PlaceKey, string>>(() => ({
    first: suggestion.ranking[0]?.registrationId ?? '',
    second: suggestion.ranking[1]?.registrationId ?? '',
    third: suggestion.ranking[2]?.registrationId ?? '',
  }));
  const chosen = [picks.first, picks.second, picks.third].filter(Boolean);
  const duplicated = new Set(chosen).size !== chosen.length;
  const options = suggestion.ranking.map((r) => ({ value: r.registrationId, label: t('opcao', { position: r.position, name: r.name }) }));

  return (
    <form
      className="flex flex-col gap-4"
      aria-label={t('formulario')}
      onSubmit={(event) => {
        event.preventDefault();
        if (!picks.first || duplicated) return;
        finish.mutate(
          { first: picks.first, second: picks.second || null, third: picks.third || null },
          {
            onSuccess: (podium) => {
              success(t('sucessoTitulo'), t('sucessoDescricao', { name: podium.places.find((p) => p.place === 1)?.name ?? '' }));
              onClose();
              onFinished?.();
            },
            onError: (e) => error(t('erroTitulo'), errorMessage(e)),
          },
        );
      }}
    >
      <p className="text-sm text-muted">{t('sugestao')}</p>
      {PLACES.map((place) => (
        <Select
          key={place.key}
          label={t(place.label)}
          required={place.key === 'first'}
          value={picks[place.key]}
          onChange={(e) => setPicks((current) => ({ ...current, [place.key]: e.target.value }))}
          placeholder={place.key === 'first' ? t('escolhaCampeao') : t('ninguemNesteLugar')}
          options={options}
          error={place.key === 'first' && !picks.first ? t('escolhaCampeao') : undefined}
        />
      ))}
      {duplicated && (
        <p role="alert" className="text-sm font-medium text-danger">
          {t('duplicado')}
        </p>
      )}
      <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-soft-text">{t('aviso')}</p>
      <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
        <Button type="button" variant="secondary" onClick={onClose}>
          {t('voltar')}
        </Button>
        <Button type="submit" variant="gold" loading={finish.isPending} disabled={!picks.first || duplicated} iconLeft={<Trophy className="size-4" aria-hidden />}>
          {t('encerrar')}
        </Button>
      </div>
    </form>
  );
}

/** Encerramento (ORG-12): pódio sugerido pela última fase, editável (1º, 2º e 3º), e confirmação. */
export function FinishDialog({ tournament, open, onOpenChange, onFinished }: { tournament: OrganizerTournamentDetail; open: boolean; onOpenChange: (open: boolean) => void; onFinished?: () => void }) {
  const suggestion = usePodiumSuggestion(tournament.id, open);
  const t = useT(messages, 'FinishDialog');
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t('titulo')} description={tournament.name}>
      {!suggestion.data ? (
        suggestion.error ? (
          <ErrorState description={errorMessage(suggestion.error)} onRetry={() => void suggestion.refetch()} />
        ) : (
          <Skeleton className="h-48 w-full" />
        )
      ) : !suggestion.data.complete ? (
        <p className="text-sm text-text">{t('partidasPendentes')}</p>
      ) : (
        <PodiumForm key={suggestion.dataUpdatedAt} tournament={tournament} suggestion={suggestion.data} onClose={() => onOpenChange(false)} onFinished={onFinished} />
      )}
    </Modal>
  );
}
