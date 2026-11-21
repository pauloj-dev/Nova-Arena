'use client';

import { Switch } from '@nova/ui';
import { Controller, useFormContext } from 'react-hook-form';
import { DateTimeField } from '../../components/DateTimeField';
import { NumberField } from '../../components/NumberField';
import type { WizardValues } from '../../lib/draft';
import { useT } from '@/shared/i18n/react';
import { useWizard } from '../context';
import { messages } from '../messages';

/** Passo 3 — Inscrições: vagas, prazos (com o fuso explícito), aprovação, lista de espera, check-in e trava de elenco. */
export function RegistrationStep() {
  const { control } = useFormContext<WizardValues>();
  const { fieldError, mode, hasStarted, takenSlots } = useWizard();
  const isTeam = (mode?.teamSize ?? 1) > 1;
  const t = useT(messages, 'RegistrationStep');

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4">
        <h3 className="text-base font-semibold text-text">{t('vagas')}</h3>
        <Controller
          control={control}
          name="maxParticipants"
          render={({ field }) => (
            <NumberField
              label={t('numeroVagas', { equipe: isTeam ? 'sim' : 'nao' })}
              min={2}
              max={1024}
              value={field.value}
              onChange={field.onChange}
              disabled={hasStarted}
              error={fieldError('maxParticipants')}
              hint={takenSlots > 0 ? t('vagasOcupadasHint', { count: takenSlots }) : t('vagasHint')}
              className="max-w-xs"
            />
          )}
        />
        <Controller
          control={control}
          name="waitlistEnabled"
          render={({ field }) => <Switch label={t('listaEspera')} hint={t('listaEsperaHint')} checked={field.value} onCheckedChange={field.onChange} />}
        />
        <Controller
          control={control}
          name="manualApproval"
          render={({ field }) => (
            <Switch
              label={t('aprovacaoManual')}
              hint={field.value ? t('aprovacaoManualLigada') : t('aprovacaoManualDesligada')}
              checked={field.value}
              onCheckedChange={field.onChange}
            />
          )}
        />
      </section>

      <section className="flex flex-col gap-4 border-t border-border pt-5">
        <div>
          <h3 className="text-base font-semibold text-text">{t('datas')}</h3>
          <p className="text-sm text-muted">{t('datasDescricao')}</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Controller
            control={control}
            name="registrationOpensAt"
            render={({ field }) => (
              <DateTimeField label={t('abertura')} value={field.value} onChange={field.onChange} disabled={hasStarted} error={fieldError('registrationOpensAt')} hint={field.value ? undefined : t('aberturaHint')} />
            )}
          />
          <Controller
            control={control}
            name="registrationClosesAt"
            render={({ field }) => <DateTimeField label={t('fechamento')} required value={field.value} onChange={field.onChange} disabled={hasStarted} error={fieldError('registrationClosesAt')} />}
          />
          <Controller
            control={control}
            name="startsAt"
            render={({ field }) => <DateTimeField label={t('inicio')} required value={field.value} onChange={field.onChange} disabled={hasStarted} error={fieldError('startsAt')} />}
          />
          {isTeam && (
            <Controller
              control={control}
              name="rosterLockAt"
              render={({ field }) => (
                <DateTimeField label={t('travaElenco')} value={field.value} onChange={field.onChange} error={fieldError('rosterLockAt')} hint={field.value ? undefined : t('travaElencoHint')} />
              )}
            />
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3 border-t border-border pt-5">
        <h3 className="text-base font-semibold text-text">{t('checkIn')}</h3>
        <Controller
          control={control}
          name="checkIn"
          render={({ field }) => {
            const checkIn = field.value;
            const set = (patch: Partial<typeof checkIn>) => field.onChange({ ...checkIn, ...patch });
            return (
              <>
                <Switch label={t('exigirCheckIn')} hint={t('exigirCheckInHint')} checked={checkIn.enabled} onCheckedChange={(enabled) => set({ enabled })} />
                {checkIn.enabled && (
                  <>
                    <div className="grid gap-4 md:grid-cols-2">
                      <NumberField label={t('abreAntes')} min={5} max={180} value={checkIn.opensMinutesBefore} onChange={(opensMinutesBefore) => set({ opensMinutesBefore })} />
                      <NumberField label={t('fechaAntes')} min={0} max={60} value={checkIn.closesMinutesBefore} onChange={(closesMinutesBefore) => set({ closesMinutesBefore })} error={fieldError('checkIn.closesMinutesBefore')} />
                    </div>
                    <p className="text-sm text-muted">
                      {t('janela', { abre: checkIn.opensMinutesBefore, fecha: checkIn.closesMinutesBefore })}
                    </p>
                    {isTeam && (
                      <Switch
                        label={t('todosMembros')}
                        hint={t('todosMembrosHint')}
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
