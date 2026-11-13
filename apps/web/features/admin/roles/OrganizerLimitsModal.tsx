'use client';

import type { AdminOrganizer } from '@nova/schemas';
import { Button, Checkbox, Input, Modal, Skeleton, Switch, useToast } from '@nova/ui';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useUpdateOrganizerLimits } from '@/shared/api/hooks/admin';
import { useGames } from '@/shared/api/hooks/games';

/** Limites do organizador (RN-10): campeonatos simultâneos, jogos permitidos (nenhum marcado = todos) e selo verificado. */
export function OrganizerLimitsModal({ organizer, onClose }: { organizer: AdminOrganizer; onClose: () => void }) {
  const toast = useToast();
  const games = useGames();
  const update = useUpdateOrganizerLimits();
  const [max, setMax] = useState(String(organizer.organizerLimits.maxActiveTournaments));
  const [allowed, setAllowed] = useState<string[]>(organizer.organizerLimits.allowedGameIds);
  const [verified, setVerified] = useState(organizer.verifiedOrganizer);
  const maxNumber = Number(max);
  const maxError = max.trim() === '' || !Number.isInteger(maxNumber) || maxNumber < 0 || maxNumber > 100 ? 'Informe um número inteiro de 0 a 100' : undefined;

  function save() {
    if (maxError) return;
    update.mutate(
      { userId: organizer.id, input: { maxActiveTournaments: maxNumber, allowedGameIds: allowed, verified } },
      {
        onSuccess: () => {
          toast.success('Limites atualizados', `${organizer.nickname}: até ${maxNumber} campeonato(s) simultâneo(s).`);
          onClose();
        },
        onError: (error) => toast.error('Não foi possível salvar os limites', errorMessage(error)),
      },
    );
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !update.isPending) onClose();
      }}
      title={`Limites de ${organizer.nickname}`}
      description={`Hoje tem ${organizer.activeTournaments} campeonato(s) em curso. O limite é conferido quando um campeonato é publicado.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={update.isPending}>
            Voltar
          </Button>
          <Button onClick={save} loading={update.isPending} disabled={Boolean(maxError)}>
            Salvar limites
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Input
          label="Campeonatos simultâneos"
          type="number"
          inputMode="numeric"
          min={0}
          max={100}
          value={max}
          onChange={(event) => setMax(event.target.value)}
          error={maxError}
          hint="Contam os publicados, com inscrições abertas ou fechadas, em check-in, em andamento e pausados. Padrão: 3 (verificado: 10)."
        />
        <Switch label="Selo de organizador verificado" hint="Aparece ao lado do nome nos campeonatos e no perfil." checked={verified} onCheckedChange={setVerified} />
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium text-text">Jogos permitidos</legend>
          <p className="text-xs text-muted">Sem nenhum marcado, o organizador pode criar campeonatos de todos os jogos ativos.</p>
          {games.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : games.isError ? (
            <p className="text-sm text-danger">{errorMessage(games.error)}</p>
          ) : (
            <div className="grid grid-cols-1 xs:grid-cols-2">
              {games.data.map((game) => (
                <Checkbox
                  key={game.id}
                  label={`${game.icon} ${game.name}`}
                  checked={allowed.includes(game.id)}
                  onCheckedChange={(checked) => setAllowed((current) => (checked ? [...current, game.id] : current.filter((id) => id !== game.id)))}
                />
              ))}
            </div>
          )}
        </fieldset>
      </div>
    </Modal>
  );
}
