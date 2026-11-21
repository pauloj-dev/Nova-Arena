'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CreateReportInput, REPORT_REASON_LABELS, ReportReason } from '@nova/schemas';
import { Button, Modal, Select, Textarea, useToast } from '@nova/ui';
import { CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { EvidenceUpload } from '@/features/evidence/EvidenceUpload';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useCreateReport } from '@/shared/api/hooks/reports';
import { useT } from '@/shared/i18n/react';
import { messages } from './messages';
import type { ReportButtonProps } from './ReportButton';

export const MAX_REPORT_ATTACHMENTS = 3;

/** Campos digitados; o alvo e os anexos entram na hora de enviar. */
const FormSchema = CreateReportInput.pick({ reason: true, description: true });
type FormValues = z.input<typeof FormSchema>;

const REASON_OPTIONS = ReportReason.options.map((value) => ({ value, label: REPORT_REASON_LABELS[value] }));

interface ReportDialogProps extends Pick<ReportButtonProps, 'targetType' | 'targetId' | 'targetLabel'> {
  onClose: () => void;
}

/** Formulário de denúncia em modal: motivo, descrição e até 3 imagens. Depois de enviar, explica o que acontece. */
export function ReportDialog({ targetType, targetId, targetLabel, onClose }: ReportDialogProps) {
  const { success, error } = useToast();
  const create = useCreateReport();
  const t = useT(messages, 'ReportDialog');
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sent, setSent] = useState(false);
  const form = useForm<FormValues>({ resolver: zodResolver(FormSchema), defaultValues: { reason: '' as FormValues['reason'], description: '' } });
  const { errors } = form.formState;
  const reasonField = form.register('reason');
  const descriptionField = form.register('description');

  const submit = form.handleSubmit((values) => {
    create.mutate(
      { targetType, targetId, reason: values.reason, description: values.description, evidenceUrls },
      {
        onSuccess: () => {
          setSent(true);
          success(t('toastEnviadaTitulo'), t('toastEnviadaDescricao'));
        },
        onError: (e) => {
          if (e instanceof ApiError) {
            for (const [field, message] of Object.entries(e.fieldErrors)) {
              if (field === 'reason' || field === 'description') form.setError(field, { message });
            }
          }
          error(t('toastErro'), errorMessage(e));
        },
      },
    );
  });

  if (sent) {
    return (
      <Modal
        open
        onOpenChange={(o) => !o && onClose()}
        title={t('enviadaTitulo')}
        footer={
          <>
            <Button asChild variant="secondary">
              <Link href="/minha-conta/denuncias" onClick={onClose}>
                {t('verMinhas')}
              </Link>
            </Button>
            <Button onClick={onClose}>{t('entendi')}</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm text-text">
          <p className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="size-5 shrink-0 text-primary-text" aria-hidden />
            {t('recebemos', { alvo: targetLabel })}
          </p>
          <p>{t('oQueAcontece')}</p>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-muted">
            <li>{t('passo1')}</li>
            <li>{t('passo2')}</li>
            <li>{t('passo3')}</li>
          </ol>
          <p className="text-muted">{t('anonimo')}</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('titulo', { alvo: targetLabel })}
      description={t('descricao', { tipo: targetType })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            {t('cancelar')}
          </Button>
          <Button type="submit" form="report-form" variant="danger" loading={create.isPending} disabled={uploading}>
            {t('enviar')}
          </Button>
        </>
      }
    >
      <form id="report-form" onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4">
        <Select label={t('motivo')} required placeholder={t('motivoPlaceholder')} options={REASON_OPTIONS} error={errors.reason ? t('motivoErro') : undefined} {...reasonField} />
        <Textarea
          label={t('oQueAconteceu')}
          required
          rows={5}
          maxLength={1000}
          hint={t('oQueAconteceuDica')}
          error={errors.description?.message}
          {...descriptionField}
        />
        <EvidenceUpload
          label={t('anexos')}
          hint={t('anexosDica', { max: MAX_REPORT_ATTACHMENTS })}
          purpose="report"
          max={MAX_REPORT_ATTACHMENTS}
          value={evidenceUrls}
          onChange={setEvidenceUrls}
          onBusyChange={setUploading}
        />
      </form>
    </Modal>
  );
}
