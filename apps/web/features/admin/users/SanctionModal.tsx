'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CreateSanctionInput, type OrphanOutcome } from '@nova/schemas';
import { Button, Modal, Select, Textarea, useToast } from '@nova/ui';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { errorMessage } from '@/shared/api/client';
import { useSanctionUser } from '@/shared/api/hooks/admin';

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

const COPY: Record<SanctionType, { title: string; verb: string; done: string; effect: string }> = {
  WARNING: { title: 'Advertir', verb: 'Advertir', done: 'Advertência aplicada', effect: 'A pessoa recebe um aviso da moderação. A conta continua ativa.' },
  SUSPENSION: { title: 'Suspender', verb: 'Suspender conta', done: 'Conta suspensa', effect: 'Vale na hora: a sessão cai e a pessoa não consegue entrar até o fim do prazo. A conta volta sozinha.' },
  BAN: { title: 'Banir', verb: 'Banir conta', done: 'Conta banida', effect: 'Vale na hora: a sessão cai e a pessoa não entra mais. Só um administrador desfaz.' },
};

const DAY_OPTIONS = [1, 3, 7, 14, 30, 90].map((d) => ({ value: String(d), label: d === 1 ? '1 dia' : `${d} dias` }));

/** Advertência, suspensão (com prazo) ou banimento, sempre com motivo. O motivo vai para a pessoa e para a auditoria. */
export function SanctionModal({ open, onOpenChange, targets, type, reportId, onDone }: SanctionModalProps) {
  const toast = useToast();
  const sanction = useSanctionUser();
  const [running, setRunning] = useState(false);
  const copy = COPY[type];
  // O modal é montado a cada abertura (quem usa renderiza sob condição), então os valores iniciais bastam.
  const { register, handleSubmit, reset, formState } = useForm<FormValues>({
    resolver: zodResolver(CreateSanctionInput),
    defaultValues: { type, reason: '', days: type === 'SUSPENSION' ? 7 : undefined, reportId },
  });
  const who = targets.length === 1 ? (targets[0]?.nickname ?? 'a conta') : `${targets.length} contas`;

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
      const paused = affected.filter((t) => t.outcome === 'PAUSED').length;
      toast.success(
        targets.length === 1 ? copy.done : `${copy.done} para ${ok} de ${targets.length} contas`,
        affected.length > 0 ? `${affected.length} campeonato(s) da organização foram afetados${paused > 0 ? `; ${paused} ficaram sem responsável` : ''}.` : undefined,
      );
    }
    if (failed.length > 0) toast.error(targets.length === 1 ? 'Não foi possível aplicar a sanção' : `${failed.length} conta(s) ficaram sem a sanção`, failed.join(' · '));
    if (ok > 0) {
      onDone?.(affected);
      close();
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next && !running) close();
      }}
      title={`${copy.title} ${who}`}
      description={copy.effect}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={running}>
            Voltar
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
            Contas: <span className="text-text">{targets.map((t) => t.nickname).join(', ')}</span>
          </p>
        )}
        {type === 'SUSPENSION' && (
          <Select
            label="Por quanto tempo"
            required
            options={DAY_OPTIONS}
            {...register('days', { setValueAs: (v: unknown) => (v === '' || v === undefined ? undefined : Number(v)) })}
            error={formState.errors.days?.message}
          />
        )}
        <Textarea
          label="Motivo"
          required
          rows={3}
          maxLength={500}
          hint="A pessoa recebe este texto na notificação."
          error={formState.errors.reason?.message}
          {...register('reason')}
        />
      </form>
    </Modal>
  );
}
