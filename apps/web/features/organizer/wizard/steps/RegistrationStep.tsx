'use client';

import { Switch } from '@nova/ui';
import { Controller, useFormContext } from 'react-hook-form';
import { DateTimeField } from '../../components/DateTimeField';
import { NumberField } from '../../components/NumberField';
import type { WizardValues } from '../../lib/draft';
import { useWizard } from '../context';

/** Passo 3 — Inscrições: vagas, prazos (com o fuso explícito), aprovação, lista de espera, check-in e trava de elenco. */
export function RegistrationStep() {
  const { control } = useFormContext<WizardValues>();
  const { fieldError, mode, hasStarted, takenSlots } = useWizard();
  const isTeam = (mode?.teamSize ?? 1) > 1;
  const unit = isTeam ? 'squads' : 'jogadores';

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4">
        <h3 className="text-base font-semibold text-text">Vagas</h3>
        <Controller
          control={control}
          name="maxParticipants"
          render={({ field }) => (
            <NumberField
              label={`Número de vagas (${unit})`}
              min={2}
              max={1024}
              value={field.value}
              onChange={field.onChange}
              disabled={hasStarted}
              error={fieldError('maxParticipants')}
              hint={takenSlots > 0 ? `${takenSlots} já ocupadas. De 2 a 1.024.` : 'De 2 a 1.024. As fases são conferidas contra este número.'}
              className="max-w-xs"
            />
          )}
        />
        <Controller
          control={control}
          name="waitlistEnabled"
          render={({ field }) => <Switch label="Lista de espera" hint="Quando as vagas acabam, quem se inscrever entra na fila e sobe sozinho se alguém sair." checked={field.value} onCheckedChange={field.onChange} />}
        />
        <Controller
          control={control}
          name="manualApproval"
          render={({ field }) => (
            <Switch
              label="Aprovar inscrições manualmente"
              hint={field.value ? 'Cada inscrição fica aguardando até você aprovar.' : 'Desligado: a inscrição é confirmada na hora (automática).'}
              checked={field.value}
              onCheckedChange={field.onChange}
            />
          )}
        />
      </section>

      <section className="flex flex-col gap-4 border-t border-border pt-5">
        <div>
          <h3 className="text-base font-semibold text-text">Datas</h3>
          <p className="text-sm text-muted">Digite no seu horário. Cada participante vê as datas no fuso dele.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Controller
            control={control}
            name="registrationOpensAt"
            render={({ field }) => (
              <DateTimeField label="Abertura das inscrições" value={field.value} onChange={field.onChange} disabled={hasStarted} error={fieldError('registrationOpensAt')} hint={field.value ? undefined : 'Em branco: abre assim que você publicar.'} />
            )}
          />
          <Controller
            control={control}
            name="registrationClosesAt"
            render={({ field }) => <DateTimeField label="Fechamento das inscrições" required value={field.value} onChange={field.onChange} disabled={hasStarted} error={fieldError('registrationClosesAt')} />}
          />
          <Controller
            control={control}
            name="startsAt"
            render={({ field }) => <DateTimeField label="Início do campeonato" required value={field.value} onChange={field.onChange} disabled={hasStarted} error={fieldError('startsAt')} />}
          />
          {isTeam && (
            <Controller
              control={control}
              name="rosterLockAt"
              render={({ field }) => (
                <DateTimeField label="Trava de elenco" value={field.value} onChange={field.onChange} error={fieldError('rosterLockAt')} hint={field.value ? undefined : 'Opcional. Depois dela os squads não trocam mais de jogadores.'} />
              )}
            />
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3 border-t border-border pt-5">
        <h3 className="text-base font-semibold text-text">Check-in</h3>
        <Controller
          control={control}
          name="checkIn"
          render={({ field }) => {
            const checkIn = field.value;
            const set = (patch: Partial<typeof checkIn>) => field.onChange({ ...checkIn, ...patch });
            return (
              <>
                <Switch label="Exigir check-in antes de cada partida" hint="Quem não confirmar presença na janela leva W.O." checked={checkIn.enabled} onCheckedChange={(enabled) => set({ enabled })} />
                {checkIn.enabled && (
                  <>
                    <div className="grid gap-4 md:grid-cols-2">
                      <NumberField label="Abre quantos minutos antes" min={5} max={180} value={checkIn.opensMinutesBefore} onChange={(opensMinutesBefore) => set({ opensMinutesBefore })} />
                      <NumberField label="Fecha quantos minutos antes" min={0} max={60} value={checkIn.closesMinutesBefore} onChange={(closesMinutesBefore) => set({ closesMinutesBefore })} error={fieldError('checkIn.closesMinutesBefore')} />
                    </div>
                    <p className="text-sm text-muted">
                      Janela: de {checkIn.opensMinutesBefore} a {checkIn.closesMinutesBefore} minutos antes de cada partida.
                    </p>
                    {isTeam && (
                      <Switch
                        label="Todos os membros do squad fazem check-in"
                        hint="Desligado: basta o capitão confirmar pelo squad."
                        checked={checkIn.requireAllMembers}
                        onCheckedChange={(requireAllMembers) => set({ requireAllMembers })}
                      />
                    )}
                  </>
                )}
              </>
            );
          }}
        />
      </section>
    </div>
  );
}
