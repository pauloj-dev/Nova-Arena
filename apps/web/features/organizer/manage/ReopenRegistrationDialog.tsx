'use client';

import type { OrganizerTournamentDetail } from '@nova/schemas';
import { Button, Modal, useToast } from '@nova/ui';
import { AlertCircle } from 'lucide-react';
import { useId, useState } from 'react';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useOpenRegistration } from '@/shared/api/hooks/organizer';
import { useT } from '@/shared/i18n/react';
import { DateTimeField } from '../components/DateTimeField';
import { messages } from './messages';

/**
 * Reabrir as inscrições (RN-16): quando falta gente ou alguém desiste depois do fechamento. Pede a nova data de
 * fechamento (a antiga já passou — fechar antes da hora grava a data de agora). Só antes de a chave ser confirmada.
 */
export function ReopenRegistrationDialog({ tournament, open, onOpenChange }: { tournament: OrganizerTournamentDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT(messages, 'SummaryTab');
  const formId = useId();
  const { success } = useToast();
  const reopen = useOpenRegistration();
  const [closesAt, setClosesAt] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  if (!open && (closesAt !== null || attempted || reopen.isError)) {
    setClosesAt(null);
    setAttempted(false);
    reopen.reset();
  }
  const fieldError = reopen.error instanceof ApiError ? reopen.error.fieldErrors.registrationClosesAt : undefined;
  const missing = attempted && closesAt === null ? t('novoFechamentoObrigatorio') : undefined;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={t('reabrirTitulo')}
      description={t('reabrirDescricao')}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('voltar')}
          </Button>
          <Button type="submit" form={formId} loading={reopen.isPending}>
            {t('reabrir')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setAttempted(true);
          if (closesAt === null) return;
          reopen.mutate(
            { id: tournament.id, registrationClosesAt: closesAt },
            {
              onSuccess: () => {
                success(t('reabertas'), t('reabertasDescricao'));
                onOpenChange(false);
              },
            },
          );
        }}
      >
        <DateTimeField label={t('novoFechamento')} hint={t('novoFechamentoDica')} required value={closesAt} onChange={setClosesAt} error={missing ?? fieldError} />
        {reopen.isError && !fieldError && (
          <div role="alert" className="flex items-start gap-2 rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger-soft-text">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p className="min-w-0 [overflow-wrap:anywhere]">
              <strong>{t('erroReabrir')}.</strong> {errorMessage(reopen.error)}
            </p>
          </div>
        )}
      </form>
    </Modal>
  );
}
