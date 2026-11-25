'use client';

import { GUEST_GAME_ID_MAX, GUEST_NAME_MAX, guestRosterProblem, ManualRegistrationInput, type ModeSize } from '@nova/schemas';
import { Button, Input, Modal, useToast } from '@nova/ui';
import { AlertCircle, UserPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useAddManualRegistration } from '@/shared/api/hooks/organizer';
import { useT } from '@/shared/i18n/react';
import { messages } from './messages';

interface AddRegistrationDialogProps {
  tournamentId: string;
  isTeam: boolean;
  /** Titulares e reservas do modo (campeonato por squad). Sem ele, o formulário não mostra o elenco. */
  roster: ModeSize | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Field = 'name' | 'tag' | 'contact' | 'gameId' | 'members';
interface Slot {
  name: string;
  gameId: string;
}

const emptySlots = (roster: ModeSize | null): Slot[] => Array.from({ length: roster ? roster.teamSize + roster.maxSubs : 0 }, () => ({ name: '', gameId: '' }));

/**
 * Inscrito avulso (RN-18): a organização cadastra um jogador ou squad sem conta na plataforma, sem planilha.
 * Em campeonato por squad, o elenco pode ser preenchido aqui mesmo (titulares e reservas do modo) ou depois,
 * pelo botão "Elenco" da inscrição.
 */
export function AddRegistrationDialog({ tournamentId, isTeam, roster, open, onOpenChange }: AddRegistrationDialogProps) {
  const t = useT(messages, 'AddRegistrationDialog');
  const add = useAddManualRegistration(tournamentId);
  const { success, error } = useToast();
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [contact, setContact] = useState('');
  const [gameId, setGameId] = useState('');
  const [slots, setSlots] = useState<Slot[]>(() => emptySlots(roster));
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});

  // O modo pode chegar depois de a tela abrir: as linhas do elenco acompanham o tamanho dele.
  const size = roster ? roster.teamSize + roster.maxSubs : 0;
  const rows = slots.length === size ? slots : [...slots, ...emptySlots(roster)].slice(0, size);

  function reset() {
    setName('');
    setTag('');
    setContact('');
    setGameId('');
    setSlots(emptySlots(roster));
    setErrors({});
  }

  function close(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function clear(field: Field) {
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function setSlot(index: number, patch: Partial<Slot>) {
    setSlots(rows.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)));
    clear('members');
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const filled = rows.map((slot, index) => ({ name: slot.name.trim(), gameId: slot.gameId.trim(), isSub: roster !== null && index >= roster.teamSize }));
    if (filled.some((slot) => slot.name === '' && slot.gameId !== '')) {
      setErrors({ members: t('idSemNome') });
      return;
    }
    const members = filled.filter((slot) => slot.name !== '').map((slot) => ({ name: slot.name, ...(slot.gameId ? { gameId: slot.gameId } : {}), ...(slot.isSub ? { isSub: true } : {}) }));
    const parsed = ManualRegistrationInput.safeParse({
      name,
      ...(isTeam && tag.trim() ? { tag } : {}),
      ...(contact.trim() ? { contact } : {}),
      ...(!isTeam && gameId.trim() ? { gameId } : {}),
      ...(members.length > 0 ? { members } : {}),
    });
    if (!parsed.success) {
      const next: Partial<Record<Field, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? 'name') as Field;
        next[field] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    const problem = roster ? guestRosterProblem(members, roster) : null;
    if (problem) {
      setErrors({ members: problem });
      return;
    }
    add.mutate(parsed.data, {
      onSuccess: (registration) => {
        success(t(registration.status === 'WAITLIST' ? 'naEspera' : 'adicionado', { nome: registration.displayName }));
        close(false);
      },
      onError: (e) => {
        const fields = e instanceof ApiError ? e.fieldErrors : {};
        if (fields.name || fields.members) setErrors({ ...(fields.name ? { name: fields.name } : {}), ...(fields.members ? { members: fields.members } : {}) });
        else error(t('erro'), errorMessage(e));
      },
    });
  }

  return (
    <Modal
      open={open}
      onOpenChange={close}
      size="lg"
      title={t('titulo', { tipo: isTeam ? 'squad' : 'jogador' })}
      description={t('descricao', { tipo: isTeam ? 'squad' : 'jogador' })}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)}>
            {t('cancelar')}
          </Button>
          <Button type="submit" form="inscrito-avulso" loading={add.isPending} iconLeft={<UserPlus className="size-4" aria-hidden />}>
            {t('adicionar')}
          </Button>
        </>
      }
    >
      <form id="inscrito-avulso" noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        <Input
          label={t('nome', { tipo: isTeam ? 'squad' : 'jogador' })}
          required
          autoFocus
          autoComplete="off"
          maxLength={60}
          value={name}
          error={errors.name}
          onChange={(e) => {
            setName(e.target.value);
            clear('name');
          }}
        />
        <div className="grid gap-4 md:grid-cols-2">
          {isTeam ? (
            <Input
              label={t('tag')}
              hint={t('tagDica')}
              autoComplete="off"
              autoCapitalize="characters"
              maxLength={5}
              value={tag}
              error={errors.tag}
              onChange={(e) => {
                setTag(e.target.value);
                clear('tag');
              }}
            />
          ) : (
            <Input
              label={t('idNoJogo')}
              hint={t('opcional')}
              autoComplete="off"
              maxLength={GUEST_GAME_ID_MAX}
              value={gameId}
              error={errors.gameId}
              onChange={(e) => {
                setGameId(e.target.value);
                clear('gameId');
              }}
            />
          )}
          <Input
            label={t('contato')}
            hint={t('contatoDica')}
            autoComplete="off"
            maxLength={120}
            value={contact}
            error={errors.contact}
            onChange={(e) => {
              setContact(e.target.value);
              clear('contact');
            }}
          />
        </div>

        {isTeam && roster && (
          <section className="flex flex-col gap-3 border-t border-border pt-4" aria-labelledby="inscrito-avulso-elenco">
            <div>
              <h3 id="inscrito-avulso-elenco" className="text-base font-bold">
                {t('elenco')}
              </h3>
              <p className="text-sm text-muted">{t('elencoDica', { titulares: roster.teamSize, reservas: roster.maxSubs })}</p>
            </div>
            {rows.map((slot, index) => {
              const isSub = index >= roster.teamSize;
              const posicao = isSub ? index - roster.teamSize + 1 : index + 1;
              return (
                <fieldset key={index} className="grid gap-x-3 gap-y-2 md:grid-cols-2" data-testid="roster-slot">
                  <legend className="mb-1 text-sm font-semibold text-text">{t(isSub ? 'reservaN' : 'titularN', { posicao })}</legend>
                  <Input label={t('jogadorNome')} autoComplete="off" maxLength={GUEST_NAME_MAX} value={slot.name} onChange={(e) => setSlot(index, { name: e.target.value })} />
                  <Input label={t('idNoJogo')} autoComplete="off" maxLength={GUEST_GAME_ID_MAX} value={slot.gameId} onChange={(e) => setSlot(index, { gameId: e.target.value })} />
                </fieldset>
              );
            })}
            {errors.members && (
              <p role="alert" className="flex items-start gap-1.5 rounded-md bg-danger-soft px-3 py-2 text-sm font-medium text-danger-soft-text">
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {errors.members}
              </p>
            )}
          </section>
        )}
      </form>
    </Modal>
  );
}
