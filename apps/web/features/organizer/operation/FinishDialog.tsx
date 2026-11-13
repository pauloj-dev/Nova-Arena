'use client';

import type { OrganizerTournamentDetail } from '@nova/schemas';
import { Button, ErrorState, Modal, Select, Skeleton, useToast } from '@nova/ui';
import { Trophy } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useFinishTournament, usePodiumSuggestion, type PodiumSuggestion } from '@/shared/api/hooks/competition';

const PLACES = [
  { key: 'first', label: '1º lugar · Campeão' },
  { key: 'second', label: '2º lugar' },
  { key: 'third', label: '3º lugar' },
] as const;
type PlaceKey = (typeof PLACES)[number]['key'];

function PodiumForm({ t, suggestion, onClose, onFinished }: { t: OrganizerTournamentDetail; suggestion: PodiumSuggestion; onClose: () => void; onFinished?: () => void }) {
  const finish = useFinishTournament(t.id);
  const { success, error } = useToast();
  const [picks, setPicks] = useState<Record<PlaceKey, string>>(() => ({
    first: suggestion.ranking[0]?.registrationId ?? '',
    second: suggestion.ranking[1]?.registrationId ?? '',
    third: suggestion.ranking[2]?.registrationId ?? '',
  }));
  const chosen = [picks.first, picks.second, picks.third].filter(Boolean);
  const duplicated = new Set(chosen).size !== chosen.length;
  const options = suggestion.ranking.map((r) => ({ value: r.registrationId, label: `${r.position}º da fase final · ${r.name}` }));

  return (
    <form
      className="flex flex-col gap-4"
      aria-label="Pódio do campeonato"
      onSubmit={(event) => {
        event.preventDefault();
        if (!picks.first || duplicated) return;
        finish.mutate(
          { first: picks.first, second: picks.second || null, third: picks.third || null },
          {
            onSuccess: (podium) => {
              success('Campeonato encerrado', `Campeão: ${podium.places.find((p) => p.place === 1)?.name ?? ''}.`);
              onClose();
              onFinished?.();
            },
            onError: (e) => error('Não foi possível encerrar o campeonato', errorMessage(e)),
          },
        );
      }}
    >
      <p className="text-sm text-muted">Sugerimos o pódio pela classificação da última fase. Ajuste se a premiação seguir outro critério.</p>
      {PLACES.map((place) => (
        <Select
          key={place.key}
          label={place.label}
          required={place.key === 'first'}
          value={picks[place.key]}
          onChange={(e) => setPicks((current) => ({ ...current, [place.key]: e.target.value }))}
          placeholder={place.key === 'first' ? 'Escolha o campeão' : 'Ninguém neste lugar'}
          options={options}
          error={place.key === 'first' && !picks.first ? 'Escolha o campeão' : undefined}
        />
      ))}
      {duplicated && (
        <p role="alert" className="text-sm font-medium text-danger">
          O mesmo participante não pode ocupar duas posições do pódio.
        </p>
      )}
      <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-soft-text">Encerrar é definitivo: o campeonato vira “Finalizado”, os resultados não mudam mais e os inscritos são avisados.</p>
      <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
        <Button type="button" variant="secondary" onClick={onClose}>
          Voltar
        </Button>
        <Button type="submit" variant="gold" loading={finish.isPending} disabled={!picks.first || duplicated} iconLeft={<Trophy className="size-4" aria-hidden />}>
          Encerrar com este pódio
        </Button>
      </div>
    </form>
  );
}

/** Encerramento (ORG-12): pódio sugerido pela última fase, editável (1º, 2º e 3º), e confirmação. */
export function FinishDialog({ tournament: t, open, onOpenChange, onFinished }: { tournament: OrganizerTournamentDetail; open: boolean; onOpenChange: (open: boolean) => void; onFinished?: () => void }) {
  const suggestion = usePodiumSuggestion(t.id, open);
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Encerrar campeonato" description={t.name}>
      {!suggestion.data ? (
        suggestion.error ? (
          <ErrorState description={errorMessage(suggestion.error)} onRetry={() => void suggestion.refetch()} />
        ) : (
          <Skeleton className="h-48 w-full" />
        )
      ) : !suggestion.data.complete ? (
        <p className="text-sm text-text">Ainda há partidas sem resultado na última fase. Conclua todas elas para definir o pódio.</p>
      ) : (
        <PodiumForm key={suggestion.dataUpdatedAt} t={t} suggestion={suggestion.data} onClose={() => onOpenChange(false)} onFinished={onFinished} />
      )}
    </Modal>
  );
}
