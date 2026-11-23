'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { SaveTemplateInput } from '@nova/schemas';
import { Button, ConfirmDestructive, Input, Modal, Textarea, useToast } from '@nova/ui';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useCancelTournament, useDeleteTournament, useSaveTemplate } from '@/shared/api/hooks/organizer';
import { useT } from '@/shared/i18n/react';
import { messages } from '../messages';

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
  const t = useT(messages, 'CancelTournamentDialog');
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
      title={t('titulo')}
      description={t('descricao')}
      confirmText={tournament.name}
      confirmLabel={t('confirmar')}
      loading={cancel.isPending}
      onConfirm={() => {
        if (reason.trim().length < 3) {
          setReasonError(t('motivoObrigatorio'));
          return;
        }
        cancel.mutate(
          { id: tournament.id, reason: reason.trim() },
          {
            onSuccess: () => {
              success(t('cancelado'));
              onOpenChange(false);
              onDone?.();
            },
            onError: (e) => {
              if (e instanceof ApiError && e.fieldErrors.reason) setReasonError(e.fieldErrors.reason);
              else error(t('erro'), errorMessage(e));
            },
          },
        );
      }}
    >
      <Textarea
        label={t('motivo')}
        required
        rows={3}
        maxLength={500}
        hint={t('motivoDica')}
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
  const t = useT(messages, 'DeleteDraftDialog');
  const remove = useDeleteTournament();
  const { success, error } = useToast();
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={t('titulo')}
      description={t('descricao', { nome: tournament.name })}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('voltar')}
          </Button>
          <Button
            variant="danger"
            loading={remove.isPending}
            onClick={() =>
              remove.mutate(tournament.id, {
                onSuccess: () => {
                  success(t('excluido'));
                  onOpenChange(false);
                  onDone?.();
                },
                onError: (e) => error(t('erro'), errorMessage(e)),
              })
            }
          >
            {t('excluir')}
          </Button>
        </>
      }
    />
  );
}

type TemplateForm = z.input<typeof SaveTemplateInput>;

/** Salvar um campeonato como modelo, para reutilizar a estrutura (ORG-02). */
export function SaveTemplateDialog({ tournament, open, onOpenChange, onDone }: DialogProps) {
  const t = useT(messages, 'SaveTemplateDialog');
  const save = useSaveTemplate();
  const { success, error } = useToast();
  const form = useForm<TemplateForm, unknown, z.output<typeof SaveTemplateInput>>({
    resolver: zodResolver(SaveTemplateInput),
    values: { tournamentId: tournament.id, name: tournament.name.slice(0, 80), description: '' },
  });
  const { errors } = form.formState;
  const nameField = form.register('name');
  const descriptionField = form.register('description');

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) form.reset();
        onOpenChange(next);
      }}
      title={t('titulo')}
      description={t('descricao')}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('voltar')}
          </Button>
          <Button type="submit" form="salvar-modelo" loading={save.isPending}>
            {t('salvar')}
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
                success(t('salvo'), t('salvoDetalhe', { nome: template.name }));
                form.reset();
                onOpenChange(false);
                onDone?.();
              },
              onError: (e) => {
                if (e instanceof ApiError && e.fieldErrors.name) form.setError('name', { message: e.fieldErrors.name });
                else error(t('erro'), errorMessage(e));
              },
            }),
          )(event)
        }
      >
        <Input label={t('nome')} required maxLength={80} error={errors.name?.message} {...nameField} />
        <Textarea label={t('descricaoCampo')} rows={3} maxLength={300} hint={t('descricaoDica')} error={errors.description?.message} {...descriptionField} />
      </form>
    </Modal>
  );
}
