'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CreateSanctionInput, type OrphanOutcome } from '@nova/schemas';
import { Button, Modal, Select, Textarea, useToast } from '@nova/ui';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { errorMessage } from '@/shared/api/client';
import { useSanctionUser } from '@/shared/api/hooks/admin';
import { useT } from '@/shared/i18n/react';
import { adminUsersMessages } from './messages';

export type SanctionType = CreateSanctionInput['type'];
type FormValues = z.input<typeof CreateSanctionInput>;

export interface SanctionTarget {
  id: string;
  nickname: string;
}

interface SanctionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Uma conta (perfil, moderação) ou várias (ação em lote na lista). */
  targets: SanctionTarget[];
  type: SanctionType;
  /** Denúncia que originou a sanção: ela é fechada junto. */
  reportId?: string;
  onDone?: (affected: OrphanOutcome[]) => void;
}

const DAYS = [1, 3, 7, 14, 30, 90];

/** Advertência, suspensão (com prazo) ou banimento, sempre com motivo. O motivo vai para a pessoa e para a auditoria. */
export function SanctionModal({ open, onOpenChange, targets, type, reportId, onDone }: SanctionModalProps) {
  const t = useT(adminUsersMessages, 'SanctionModal');
  const toast = useToast();
  const sanction = useSanctionUser();
  const [running, setRunning] = useState(false);
  const copy = { title: t(`${type}.titulo`), verb: t(`${type}.verbo`), done: t(`${type}.feito`), effect: t(`${type}.efeito`) };
  const dayOptions = DAYS.map((d) => ({ value: String(d), label: t('dias', { dias: d, n: String(d) }) }));
  // O modal é montado a cada abertura (quem usa renderiza sob condição), então os valores iniciais bastam.
  const { register, handleSubmit, reset, formState } = useForm<FormValues>({
    resolver: zodResolver(CreateSanctionInput),
    defaultValues: { type, reason: '', days: type === 'SUSPENSION' ? 7 : undefined, reportId },
  });
  const who = targets.length === 1 ? (targets[0]?.nickname ?? t('aConta')) : t('nContas', { n: String(targets.length) });

  function close() {
    reset();
    onOpenChange(false);
  }

  async function submit(values: FormValues) {
    setRunning(true);
    const input = CreateSanctionInput.parse(values);
    const failed: string[] = [];
    const affected: OrphanOutcome[] = [];
    for (const target of targets) {
      try {
        const result = await sanction.mutateAsync({ userId: target.id, input });
        affected.push(...result.affectedTournaments);
      } catch (error) {
        failed.push(`${target.nickname}: ${errorMessage(error)}`);
      }
    }
    setRunning(false);
    const ok = targets.length - failed.length;
    if (ok > 0) {
      const paused = affected.filter((outcome) => outcome.outcome === 'PAUSED').length;
      toast.success(
        targets.length === 1 ? copy.done : t('feitoLote', { feito: copy.done, ok: String(ok), total: String(targets.length) }),
        affected.length > 0
          ? paused > 0
            ? t('afetadosSemResponsavel', { n: String(affected.length), pausados: String(paused) })
            : t('afetados', { n: String(affected.length) })
          : undefined,
      );
    }
    if (failed.length > 0) toast.error(targets.length === 1 ? t('falhaUma') : t('falhaLote', { n: String(failed.length) }), failed.join(' · '));
    if (ok > 0) {
      onDone?.(affected);
      close();
    }
  }

  const accounts = t.rich('contas', { lista: targets.map((target) => target.nickname).join(', '), destaque: (chunks) => <span className="text-text">{chunks}</span> });
  const daysField = type !== 'SUSPENSION' ? undefined : register('days',{ setValueAs: (v: unknown) => (v === '' || v === undefined ? undefined : Number(v)) });
  const reasonField = register('reason');

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next && !running) close();
      }}
      title={t('tituloModal', { acao: copy.title, quem: who })}
      description={copy.effect}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={running}>
            {t('voltar')}
          </Button>
          <Button type="submit" form="sanction-form" variant={type === 'WARNING' ? 'primary' : 'danger'} loading={running}>
            {copy.verb}
          </Button>
        </>
      }
    >
      <form id="sanction-form" onSubmit={(event) => void handleSubmit(submit)(event)} className="flex flex-col gap-4" noValidate>
        {targets.length > 1 && (
          <p className="text-sm text-muted [overflow-wrap:anywhere]">
            {accounts}
          </p>
        )}
        {type === 'SUSPENSION' && (
          <Select
            label={t('prazo')}
            required
            options={dayOptions}
            {...daysField}
            error={formState.errors.days?.message}
          />
        )}
        <Textarea label={t('motivo')} required rows={3} maxLength={500} hint={t('motivoDica')} error={formState.errors.reason?.message} {...reasonField} />
      </form>
    </Modal>
  );
}
