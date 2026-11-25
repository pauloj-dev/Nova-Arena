'use client';

import { GUEST_GAME_ID_MAX, GUEST_NAME_MAX, type ModeSize, type OrganizerTournamentDetail, type Registration, type RegistrationGuest } from '@nova/schemas';
import { Badge, Button, Checkbox, Input, Modal, useToast } from '@nova/ui';
import { Pencil, UserMinus, UserPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useAddGuest, useRemoveGuest, useUpdateGuest } from '@/shared/api/hooks/organizer';
import { useT } from '@/shared/i18n/react';
import { messages } from './messages';

interface GuestRosterDialogProps {
  tournament: OrganizerTournamentDetail;
  registration: Registration;
  /** Titulares e reservas do modo do campeonato. */
  roster: ModeSize | null;
  onClose: () => void;
}

/**
 * Elenco de um squad sem conta na plataforma (importado da planilha ou cadastrado pela organização, RN-18):
 * colocar, corrigir e tirar jogadores, só com nome e ID no jogo. Segue o modo do campeonato (titulares e reservas).
 */
export function GuestRosterDialog({ tournament, registration, roster, onClose }: GuestRosterDialogProps) {
  const t = useT(messages, 'GuestRosterDialog');
  const { success, error } = useToast();
  const add = useAddGuest(tournament.id);
  const update = useUpdateGuest(tournament.id);
  const remove = useRemoveGuest(tournament.id);
  const [editing, setEditing] = useState<RegistrationGuest | null>(null);
  const [name, setName] = useState('');
  const [gameId, setGameId] = useState('');
  const [isSub, setIsSub] = useState(false);
  const [nameError, setNameError] = useState<string | undefined>();

  const guests = registration.guests;
  const starters = guests.filter((g) => !g.isSub).length;
  const subs = guests.length - starters;
  const limit = roster ? roster.teamSize + roster.maxSubs : registration.requiredMembers;
  const full = guests.length >= limit;
  // Titulares completos: o próximo jogador só entra como reserva.
  const startersFull = roster !== null && starters >= roster.teamSize;
  const subsFull = roster !== null && subs >= roster.maxSubs;
  const busy = add.isPending || update.isPending || remove.isPending;

  const showForm = editing !== null || !full;
  // Ao colocar: titulares completos obrigam a reserva; reservas completas obrigam o titular.
  const subLocked = editing === null && (startersFull || subsFull);
  const asSub = editing !== null ? isSub : startersFull ? true : subsFull ? false : isSub;

  function resetForm() {
    setEditing(null);
    setName('');
    setGameId('');
    setIsSub(false);
    setNameError(undefined);
  }

  function startEditing(guest: RegistrationGuest) {
    setEditing(guest);
    setName(guest.name);
    setGameId(guest.gameId ?? '');
    setIsSub(guest.isSub);
    setNameError(undefined);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(t('nomeObrigatorio'));
      return;
    }
    const onError = (e: unknown) => setNameError(errorMessage(e));
    if (editing) {
      update.mutate(
        { registrationId: registration.id, guestId: editing.id, input: { name: trimmed, gameId: gameId.trim() || null, isSub: asSub } },
        {
          onSuccess: () => {
            success(t('corrigiu', { nome: trimmed }));
            resetForm();
          },
          onError,
        },
      );
      return;
    }
    add.mutate(
      { registrationId: registration.id, input: { name: trimmed, ...(gameId.trim() ? { gameId: gameId.trim() } : {}), isSub: asSub } },
      {
        onSuccess: () => {
          success(t('escalou', { nome: trimmed }));
          resetForm();
        },
        onError,
      },
    );
  }


  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('titulo', { nome: registration.displayName })}
      description={t('descricao')}
      size="lg"
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t('fechar')}
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted" role="status">
            {roster ? t('contagem', { titulares: starters, exigidos: roster.teamSize, reservas: subs, maxReservas: roster.maxSubs }) : t('contagemSimples', { count: guests.length })}
          </p>
          {guests.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted">{t('vazio')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border" aria-label={t('elencoDo', { nome: registration.displayName })}>
              {guests.map((guest) => (
                <li key={guest.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" data-testid="guest">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-sm font-medium text-text">{guest.name}</span>
                    {guest.isSub && <Badge tone="neutral">{t('reserva')}</Badge>}
                    <span className="tabular text-xs text-muted">{guest.gameId ? t('id', { id: guest.gameId }) : t('semId')}</span>
                  </div>
                  <span className="flex shrink-0 gap-1">
                    <Button size="sm" variant="ghost" iconLeft={<Pencil className="size-4" aria-hidden />} aria-label={t('corrigirRotulo', { nome: guest.name })} disabled={busy} onClick={() => startEditing(guest)}>
                      {t('corrigir')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      iconLeft={<UserMinus className="size-4" aria-hidden />}
                      aria-label={t('tirarRotulo', { nome: guest.name })}
                      loading={remove.isPending && remove.variables?.guestId === guest.id}
                      disabled={busy}
                      onClick={() =>
                        remove.mutate(
                          { registrationId: registration.id, guestId: guest.id },
                          {
                            onSuccess: () => {
                              success(t('tirou', { nome: guest.name }));
                              if (editing?.id === guest.id) resetForm();
                            },
                            onError: (e) => error(t('erro'), errorMessage(e)),
                          },
                        )
                      }
                    >
                      {t('tirar')}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {showForm ? (
          <form noValidate onSubmit={onSubmit} className="flex flex-col gap-3 border-t border-border pt-4">
            <h3 className="text-base font-bold">{editing ? t('corrigirTitulo', { nome: editing.name }) : t('escalarTitulo')}</h3>
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                label={t('nome')}
                required
                autoComplete="off"
                maxLength={GUEST_NAME_MAX}
                value={name}
                error={nameError}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameError(undefined);
                }}
              />
              <Input label={t('idNoJogo')} hint={t('opcional')} autoComplete="off" maxLength={GUEST_GAME_ID_MAX} value={gameId} onChange={(e) => setGameId(e.target.value)} />
            </div>
            {roster !== null && roster.maxSubs > 0 && (
              <Checkbox
                label={t('ehReserva')}
                hint={subLocked ? t(startersFull ? 'soReserva' : 'soTitular') : undefined}
                checked={asSub}
                disabled={subLocked}
                onCheckedChange={setIsSub}
              />
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" loading={add.isPending || update.isPending} disabled={remove.isPending} iconLeft={editing ? <Pencil className="size-4" aria-hidden /> : <UserPlus className="size-4" aria-hidden />}>
                {editing ? t('salvar') : t('escalar')}
              </Button>
              {editing && (
                <Button type="button" size="sm" variant="secondary" disabled={update.isPending} onClick={resetForm}>
                  {t('cancelar')}
                </Button>
              )}
            </div>
          </form>
        ) : (
          <p className="border-t border-border pt-4 text-sm text-muted">{t('completo')}</p>
        )}
      </div>
    </Modal>
  );
}
