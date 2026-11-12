'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { SaveTemplateInput } from '@nova/schemas';
import { Button, ConfirmDestructive, Input, Modal, Textarea, useToast } from '@nova/ui';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useCancelTournament, useDeleteTournament, useSaveTemplate } from '@/shared/api/hooks/organizer';

interface TournamentRef {
  id: string;
  name: string;
}

interface DialogProps {
  tournament: TournamentRef;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}

/** Cancelar campeonato: exige digitar o nome e informar o motivo (PRD §15.8). */
export function CancelTournamentDialog({ tournament, open, onOpenChange, onDone }: DialogProps) {
  const cancel = useCancelTournament();
  const { success, error } = useToast();
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>();
  // Fechou: o motivo digitado não sobra para a próxima abertura.
  if (!open && (reason !== '' || reasonError)) {
    setReason('');
    setReasonError(undefined);
  }

  return (
    <ConfirmDestructive
      open={open}
      onOpenChange={onOpenChange}
      title="Cancelar campeonato"
      description="O campeonato sai da vitrine e as inscrições são encerradas. Não dá para desfazer."
      confirmText={tournament.name}
      confirmLabel="Cancelar campeonato"
      loading={cancel.isPending}
      onConfirm={() => {
        if (reason.trim().length < 3) {
          setReasonError('Informe o motivo do cancelamento.');
          return;
        }
        cancel.mutate(
          { id: tournament.id, reason: reason.trim() },
          {
            onSuccess: () => {
              success('Campeonato cancelado');
              onOpenChange(false);
              onDone?.();
            },
            onError: (e) => {
              if (e instanceof ApiError && e.fieldErrors.reason) setReasonError(e.fieldErrors.reason);
              else error('Não foi possível cancelar', errorMessage(e));
            },
          },
        );
      }}
    >
      <Textarea
        label="Motivo do cancelamento"
        required
        rows={3}
        maxLength={500}
        hint="Aparece para quem acompanha a página do campeonato."
        value={reason}
        error={reasonError}
        onChange={(e) => {
          setReason(e.target.value);
          setReasonError(undefined);
        }}
      />
    </ConfirmDestructive>
  );
}

/** Excluir rascunho: confirmação simples (nada foi publicado ainda). */
export function DeleteDraftDialog({ tournament, open, onOpenChange, onDone }: DialogProps) {
  const remove = useDeleteTournament();
  const { success, error } = useToast();
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title="Excluir este rascunho?"
      description={`"${tournament.name}" ainda não foi publicado. O rascunho será apagado de vez.`}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Voltar
          </Button>
          <Button
            variant="danger"
            loading={remove.isPending}
            onClick={() =>
              remove.mutate(tournament.id, {
                onSuccess: () => {
                  success('Rascunho excluído');
                  onOpenChange(false);
                  onDone?.();
                },
                onError: (e) => error('Não foi possível excluir', errorMessage(e)),
              })
            }
          >
            Excluir rascunho
          </Button>
        </>
      }
    />
  );
}

type TemplateForm = z.input<typeof SaveTemplateInput>;

/** Salvar um campeonato como modelo, para reutilizar a estrutura (ORG-02). */
export function SaveTemplateDialog({ tournament, open, onOpenChange, onDone }: DialogProps) {
  const save = useSaveTemplate();
  const { success, error } = useToast();
  const form = useForm<TemplateForm, unknown, z.output<typeof SaveTemplateInput>>({
    resolver: zodResolver(SaveTemplateInput),
    values: { tournamentId: tournament.id, name: tournament.name.slice(0, 80), description: '' },
  });
  const { errors } = form.formState;

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) form.reset();
        onOpenChange(next);
      }}
      title="Salvar como modelo"
      description="O modelo guarda jogo, vagas, fases, pontuação e regulamento. Nome, datas e banner ficam de fora."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Voltar
          </Button>
          <Button type="submit" form="salvar-modelo" loading={save.isPending}>
            Salvar modelo
          </Button>
        </>
      }
    >
      <form
        id="salvar-modelo"
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) =>
          void form.handleSubmit((input) =>
            save.mutate(input, {
              onSuccess: (template) => {
                success('Modelo salvo', `"${template.name}" já aparece em Modelos.`);
                form.reset();
                onOpenChange(false);
                onDone?.();
              },
              onError: (e) => {
                if (e instanceof ApiError && e.fieldErrors.name) form.setError('name', { message: e.fieldErrors.name });
                else error('Não foi possível salvar o modelo', errorMessage(e));
              },
            }),
          )(event)
        }
      >
        <Input label="Nome do modelo" required maxLength={80} error={errors.name?.message} {...form.register('name')} />
        <Textarea label="Descrição" rows={3} maxLength={300} hint="Opcional. Uma frase para lembrar quando usar este modelo." error={errors.description?.message} {...form.register('description')} />
      </form>
    </Modal>
  );
}
