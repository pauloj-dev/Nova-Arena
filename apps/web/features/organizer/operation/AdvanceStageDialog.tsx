'use client';

import type { Stage } from '@nova/schemas';
import { Badge, Button, ErrorState, Modal, Skeleton, useToast } from '@nova/ui';
import { ArrowRight, CheckCircle2, LifeBuoy } from 'lucide-react';
import { errorMessage } from '@/shared/api/client';
import { useAdvancePreview, useAdvanceStage } from '@/shared/api/hooks/competition';
import { seedingContainers } from './stageUtils';

export interface AdvanceStageDialogProps {
  stage: Stage;
  nextStage: Stage;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdvanced?: () => void;
}

/**
 * Assistente "Avançar fase" (PRD §10.5): mostra quem se classificou (posição, grupo e se veio pela
 * repescagem), quem foi eliminado e como fica a chave da próxima fase. Nada é gravado até confirmar.
 */
export function AdvanceStageDialog({ stage, nextStage, open, onOpenChange, onAdvanced }: AdvanceStageDialogProps) {
  const preview = useAdvancePreview(stage.id, open);
  const advance = useAdvanceStage(stage.id);
  const { success, error } = useToast();
  const data = preview.data;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={`Avançar de "${stage.name}" para "${nextStage.name}"`}
      description="Confira a prévia. Depois de confirmar, você ainda ajusta e confirma a chave da próxima fase."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Voltar
          </Button>
          <Button
            loading={advance.isPending}
            disabled={!data}
            iconLeft={<ArrowRight className="size-4" aria-hidden />}
            onClick={() =>
              advance.mutate(undefined, {
                onSuccess: () => {
                  success('Fase avançada', `Os classificados já estão em "${nextStage.name}". Ajuste e confirme a chave.`);
                  onOpenChange(false);
                  onAdvanced?.();
                },
                onError: (e) => error('Não foi possível avançar a fase', errorMessage(e)),
              })
            }
          >
            Confirmar avanço
          </Button>
        </>
      }
    >
      {!data ? (
        preview.error ? (
          <ErrorState description={errorMessage(preview.error)} onRetry={() => void preview.refetch()} />
        ) : (
          <div className="flex flex-col gap-3" role="status" aria-label="Calculando a prévia">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )
      ) : (
        <div className="flex flex-col gap-5" data-testid="advance-preview">
          <section className="flex flex-col gap-2" aria-labelledby="avanco-classificados">
            <h3 id="avanco-classificados" className="text-base">
              Classificados ({data.qualified.length})
            </h3>
            <ol className="flex flex-col divide-y divide-border rounded-lg border border-border" data-testid="advance-qualified">
              {data.qualified.map((q) => (
                <li key={q.registrationId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  <span className="tabular w-6 shrink-0 text-center text-xs text-muted">
                    <span className="sr-only">Cabeça de chave </span>
                    {q.seed}
                  </span>
                  <span className="min-w-0 flex-1 font-semibold text-text">{q.name}</span>
                  <span className="text-muted">
                    {q.groupPosition}º{q.groupName ? ` · ${q.groupName}` : ''}
                  </span>
                  {q.via === 'REPECHAGE' ? (
                    <Badge tone="info" icon={<LifeBuoy className="size-3.5" aria-hidden />}>
                      Via repescagem
                    </Badge>
                  ) : (
                    <Badge tone="primary" icon={<CheckCircle2 className="size-3.5" aria-hidden />}>
                      Classificado
                    </Badge>
                  )}
                </li>
              ))}
            </ol>
          </section>

          <section className="flex flex-col gap-2" aria-labelledby="avanco-eliminados">
            <h3 id="avanco-eliminados" className="text-base">
              Eliminados ({data.eliminated.length})
            </h3>
            {data.eliminated.length === 0 ? <p className="text-sm text-muted">Ninguém é eliminado nesta passagem.</p> : <p className="text-sm text-text">{data.eliminated.map((e) => e.name).join(', ')}</p>}
          </section>

          <section className="flex flex-col gap-2" aria-labelledby="avanco-proxima">
            <h3 id="avanco-proxima" className="text-base">
              Chave de “{nextStage.name}”
            </h3>
            <div className="grid grid-cols-1 gap-3 xs:grid-cols-2">
              {seedingContainers(data.next).map((container) => (
                <div key={container.id} className="rounded-lg border border-border bg-surface-2 p-3">
                  <h4 className="text-sm font-semibold text-text">{container.label}</h4>
                  <ul className="mt-1 flex flex-col gap-0.5 text-sm text-text">
                    {container.slots.map((s) => (
                      <li key={s.registrationId} className="flex gap-2">
                        {s.seed !== null && <span className="tabular w-5 shrink-0 text-center text-xs text-muted">{s.seed}</span>}
                        <span className="min-w-0 truncate">{s.name}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </Modal>
  );
}
