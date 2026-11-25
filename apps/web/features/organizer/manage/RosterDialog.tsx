'use client';

import type { OrganizerTournamentDetail, Registration } from '@nova/schemas';
import { Button, Input, Modal, Select, useToast } from '@nova/ui';
import { ArrowRightLeft, UserMinus, UserPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { RegistrationMembers } from '@/features/registrations/RegistrationMembers';
import { errorMessage } from '@/shared/api/client';
import { useGame } from '@/shared/api/hooks/games';
import { useAddRosterMember, useMoveRosterMember, useRemoveRosterMember } from '@/shared/api/hooks/registrations';
import { useT } from '@/shared/i18n/react';
import { rosterLimit } from '@/features/registrations/lib/rules';
import { messages } from './messages';

const STARTED = ['CHECK_IN', 'IN_PROGRESS', 'PAUSED'];

/**
 * Elenco de um squad inscrito, para a organização (PRD §12.1, trava de elenco): tirar, escalar pelo apelido e
 * remanejar para outro squad do mesmo campeonato. Quem a organização escala entra confirmado e recebe um aviso.
 */
export function RosterDialog({ tournament, registration, others, onClose }: { tournament: OrganizerTournamentDetail; registration: Registration; others: Registration[]; onClose: () => void }) {
  const t = useT(messages, 'RosterDialog');
  const { success, error } = useToast();
  const add = useAddRosterMember();
  const remove = useRemoveRosterMember();
  const move = useMoveRosterMember();
  const [nickname, setNickname] = useState('');
  const [nicknameError, setNicknameError] = useState<string | undefined>();
  const [moving, setMoving] = useState<{ userId: string; nickname: string } | null>(null);
  const [target, setTarget] = useState('');
  const game = useGame(tournament.gameId);
  const mode = game.data?.modes.find((m) => m.id === tournament.gameModeId);
  const limit = mode ? rosterLimit(mode) : registration.requiredMembers;
  const busy = add.isPending || remove.isPending || move.isPending;
  const fail = (e: unknown) => error(t('erro'), errorMessage(e));

  function onAdd(event: FormEvent) {
    event.preventDefault();
    const nick = nickname.trim();
    if (!nick) {
      setNicknameError(t('apelidoObrigatorio'));
      return;
    }
    add.mutate(
      { registrationId: registration.id, input: { nickname: nick } },
      {
        onSuccess: () => {
          success(t('escalou', { nome: nick.replace(/^@/, '') }));
          setNickname('');
        },
        onError: (e) => setNicknameError(errorMessage(e)),
      },
    );
  }

  function onMove() {
    if (!moving || !target) return;
    const to = others.find((o) => o.id === target);
    move.mutate(
      { registrationId: registration.id, userId: moving.userId, toRegistrationId: target },
      {
        onSuccess: () => {
          success(t('moveu', { nome: moving.nickname, squad: to?.displayName ?? '' }));
          setMoving(null);
          setTarget('');
        },
        onError: fail,
      },
    );
  }

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('titulo', { nome: registration.displayName })}
      description={STARTED.includes(tournament.status) ? `${t('descricao')} ${t('emAndamento')}` : t('descricao')}
      size="lg"
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t('fechar')}
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted">{t('contagem', { count: registration.members.length, limite: limit })}</p>
          <RegistrationMembers
            registration={registration}
            viewerId={null}
            actions={(m) =>
              m.isCaptain ? null : (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    iconLeft={<ArrowRightLeft className="size-4" aria-hidden />}
                    aria-label={t('moverRotulo', { nome: m.nickname })}
                    disabled={busy}
                    onClick={() => {
                      setMoving({ userId: m.userId, nickname: m.nickname });
                      setTarget('');
                    }}
                  >
                    {t('mover')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    iconLeft={<UserMinus className="size-4" aria-hidden />}
                    aria-label={t('tirarRotulo', { nome: m.nickname })}
                    loading={remove.isPending && remove.variables?.userId === m.userId}
                    disabled={busy}
                    onClick={() => remove.mutate({ registrationId: registration.id, userId: m.userId }, { onSuccess: () => success(t('tirou', { nome: m.nickname })), onError: fail })}
                  >
                    {t('tirar')}
                  </Button>
                </>
              )
            }
          />
        </div>

        {moving && (
          <div className="flex flex-col gap-3 rounded-md border border-border p-3" data-testid="move-player">
            {others.length === 0 ? (
              <p className="text-sm text-muted">{t('semOutrosSquads')}</p>
            ) : (
              <Select
                label={t('moverPara', { nome: moving.nickname })}
                placeholder={t('escolhaSquad')}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                options={others.map((o) => ({ value: o.id, label: o.tag ? `${o.displayName} [${o.tag}]` : o.displayName }))}
              />
            )}
            <div className="flex flex-wrap gap-2">
              {others.length > 0 && (
                <Button size="sm" loading={move.isPending} disabled={!target} onClick={onMove}>
                  {t('confirmarMover')}
                </Button>
              )}
              <Button size="sm" variant="secondary" disabled={move.isPending} onClick={() => setMoving(null)}>
                {t('cancelar')}
              </Button>
            </div>
          </div>
        )}

        {registration.members.length < limit && (
          <form noValidate onSubmit={onAdd} className="flex flex-col gap-3 border-t border-border pt-4">
            <h3 className="text-base font-bold">{t('escalarTitulo')}</h3>
            <Input
              label={t('apelido')}
              placeholder={t('apelidoPlaceholder')}
              autoComplete="off"
              autoCapitalize="none"
              value={nickname}
              error={nicknameError}
              onChange={(e) => {
                setNickname(e.target.value);
                setNicknameError(undefined);
              }}
            />
            <Button type="submit" size="sm" className="self-start" loading={add.isPending} disabled={busy && !add.isPending} iconLeft={<UserPlus className="size-4" aria-hidden />}>
              {t('escalar')}
            </Button>
          </form>
        )}
      </div>
    </Modal>
  );
}
