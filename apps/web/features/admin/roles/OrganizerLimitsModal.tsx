'use client';

import type { AdminOrganizer } from '@nova/schemas';
import { Button, Checkbox, Input, Modal, Skeleton, Switch, useToast } from '@nova/ui';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useUpdateOrganizerLimits } from '@/shared/api/hooks/admin';
import { useGames } from '@/shared/api/hooks/games';
import { useT } from '@/shared/i18n/react';
import { adminRolesMessages } from './messages';

/** Limites do organizador (RN-10): campeonatos simultâneos, jogos permitidos (nenhum marcado = todos) e selo verificado. */
export function OrganizerLimitsModal({ organizer, onClose }: { organizer: AdminOrganizer; onClose: () => void }) {
  const t = useT(adminRolesMessages, 'OrganizerLimitsModal');
  const toast = useToast();
  const games = useGames();
  const update = useUpdateOrganizerLimits();
  const [max, setMax] = useState(String(organizer.organizerLimits.maxActiveTournaments));
  const [allowed, setAllowed] = useState<string[]>(organizer.organizerLimits.allowedGameIds);
  const [verified, setVerified] = useState(organizer.verifiedOrganizer);
  const maxNumber = Number(max);
  const maxError = max.trim() === '' || !Number.isInteger(maxNumber) || maxNumber < 0 || maxNumber > 100 ? t('erroMaximo') : undefined;

  function save() {
    if (maxError) return;
    update.mutate(
      { userId: organizer.id, input: { maxActiveTournaments: maxNumber, allowedGameIds: allowed, verified } },
      {
        onSuccess: () => {
          toast.success(t('atualizados'), t('atualizadosDescricao', { nome: organizer.nickname, max: String(maxNumber) }));
          onClose();
        },
        onError: (error) => toast.error(t('erroSalvar'), errorMessage(error)),
      },
    );
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !update.isPending) onClose();
      }}
      title={t('titulo', { nome: organizer.nickname })}
      description={t('descricao', { ativos: String(organizer.activeTournaments) })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={update.isPending}>
            {t('voltar')}
          </Button>
          <Button onClick={save} loading={update.isPending} disabled={Boolean(maxError)}>
            {t('salvar')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Input
          label={t('simultaneos')}
          type="number"
          inputMode="numeric"
          min={0}
          max={100}
          value={max}
          onChange={(event) => setMax(event.target.value)}
          error={maxError}
          hint={t('simultaneosDica')}
        />
        <Switch label={t('selo')} hint={t('seloDica')} checked={verified} onCheckedChange={setVerified} />
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium text-text">{t('jogosPermitidos')}</legend>
          <p className="text-xs text-muted">{t('jogosPermitidosDica')}</p>
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
