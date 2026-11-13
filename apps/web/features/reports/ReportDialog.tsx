'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CreateReportInput, REPORT_REASON_LABELS, ReportReason } from '@nova/schemas';
import { Button, Modal, Select, Textarea, useToast } from '@nova/ui';
import { CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { EvidenceUploader } from '@/features/disputes/evidence/EvidenceUploader';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useCreateReport } from '@/shared/api/hooks/reports';
import type { ReportButtonProps } from './ReportButton';

export const MAX_REPORT_ATTACHMENTS = 3;

/** Campos digitados; o alvo e os anexos entram na hora de enviar. */
const FormSchema = CreateReportInput.pick({ reason: true, description: true });
type FormValues = z.input<typeof FormSchema>;

const REASON_OPTIONS = ReportReason.options.map((value) => ({ value, label: REPORT_REASON_LABELS[value] }));

const WHAT: Record<ReportButtonProps['targetType'], string> = {
  USER: 'o jogador',
  TEAM: 'o squad',
  MATCH: 'a partida',
  RESULT: 'o resultado',
};

interface ReportDialogProps extends Pick<ReportButtonProps, 'targetType' | 'targetId' | 'targetLabel'> {
  onClose: () => void;
}

/** Formulário de denúncia em modal: motivo, descrição e até 3 imagens. Depois de enviar, explica o que acontece. */
export function ReportDialog({ targetType, targetId, targetLabel, onClose }: ReportDialogProps) {
  const { success, error } = useToast();
  const create = useCreateReport();
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sent, setSent] = useState(false);
  const form = useForm<FormValues>({ resolver: zodResolver(FormSchema), defaultValues: { reason: '' as FormValues['reason'], description: '' } });
  const { errors } = form.formState;

  const submit = form.handleSubmit((values) => {
    create.mutate(
      { targetType, targetId, reason: values.reason, description: values.description, evidenceUrls },
      {
        onSuccess: () => {
          setSent(true);
          success('Denúncia enviada', 'A moderação vai analisar. Acompanhe em Minha conta › Denúncias.');
        },
        onError: (e) => {
          if (e instanceof ApiError) {
            for (const [field, message] of Object.entries(e.fieldErrors)) {
              if (field === 'reason' || field === 'description') form.setError(field, { message });
            }
          }
          error('Não foi possível enviar a denúncia', errorMessage(e));
        },
      },
    );
  });

  if (sent) {
    return (
      <Modal
        open
        onOpenChange={(o) => !o && onClose()}
        title="Denúncia enviada"
        footer={
          <>
            <Button asChild variant="secondary">
              <Link href="/minha-conta/denuncias" onClick={onClose}>
                Ver minhas denúncias
              </Link>
            </Button>
            <Button onClick={onClose}>Entendi</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm text-text">
          <p className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="size-5 shrink-0 text-primary-text" aria-hidden />
            Recebemos sua denúncia sobre {targetLabel}.
          </p>
          <p>O que acontece agora:</p>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-muted">
            <li>A moderação da Nova Arena analisa o que você contou e os anexos.</li>
            <li>Se for preciso, quem foi denunciado recebe uma advertência, suspensão ou banimento.</li>
            <li>Você acompanha o andamento e a resposta em Minha conta › Denúncias.</li>
          </ol>
          <p className="text-muted">Quem foi denunciado não fica sabendo quem denunciou.</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Denunciar ${targetLabel}`}
      description={`Conte o que aconteceu com ${WHAT[targetType]}. Só a moderação vê a sua denúncia.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            Cancelar
          </Button>
          <Button type="submit" form="report-form" variant="danger" loading={create.isPending} disabled={uploading}>
            Enviar denúncia
          </Button>
        </>
      }
    >
      <form id="report-form" onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4">
        <Select label="Motivo" required placeholder="Escolha o motivo" options={REASON_OPTIONS} error={errors.reason ? 'Escolha um motivo' : undefined} {...form.register('reason')} />
        <Textarea
          label="O que aconteceu?"
          required
          rows={5}
          maxLength={1000}
          hint="Diga quando foi e em qual partida ou campeonato. Quanto mais detalhe, mais rápida a análise."
          error={errors.description?.message}
          {...form.register('description')}
        />
        <EvidenceUploader
          label="Anexos (opcional)"
          hint={`Até ${MAX_REPORT_ATTACHMENTS} imagens PNG, JPG ou WebP de até 5 MB: prints do chat, do placar ou do perfil.`}
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
