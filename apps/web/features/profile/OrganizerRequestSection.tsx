'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { OrganizerRequestInput, type OrganizerRequest } from '@nova/schemas';
import { Button, ErrorState, Skeleton, StatusPill, Textarea, useToast } from '@nova/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useCreateOrganizerRequest, useOrganizerRequest } from '@/shared/api/hooks/users';
import { keys } from '@/shared/api/keys';
import { useT } from '@/shared/i18n/react';
import { formatDate } from '@/shared/lib/datetime';
import { messages } from './messages';

type RequestValues = z.input<typeof OrganizerRequestInput>;
const MIN = 30;
const MAX = 1000;

function RequestForm() {
  const t = useT(messages, 'OrganizerRequestSection');
  const { success, error } = useToast();
  const qc = useQueryClient();
  const create = useCreateOrganizerRequest();
  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors },
  } = useForm<RequestValues>({ resolver: zodResolver(OrganizerRequestInput), defaultValues: { justification: '' } });
  const text = useWatch({ control, name: 'justification' }) ?? '';
  const justificationField = register('justification');

  const onSubmit = handleSubmit((values) => {
    create.mutate(values.justification, {
      onSuccess: () => success(t('enviadoTitulo'), t('enviadoDescricao')),
      onError: (e) => {
        if (e instanceof ApiError && e.fieldErrors.justification) {
          setError('justification', { type: 'server', message: e.fieldErrors.justification }, { shouldFocus: true });
          return;
        }
        // 409: já existe pedido em análise ou a pessoa já virou organizadora. Mostra o motivo e atualiza o estado.
        setError('root', { type: 'server', message: errorMessage(e) });
        error(t('erroEnviar'), errorMessage(e));
        if (e instanceof ApiError && e.status === 409) {
          void qc.invalidateQueries({ queryKey: keys.organizerRequest });
          void qc.invalidateQueries({ queryKey: keys.me });
        }
      },
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <Textarea
        label={t('porQue')}
        rows={5}
        maxLength={MAX}
        required
        hint={
          <>
            {t('dica', { min: MIN })} <span className="tabular">{text.length}/{MAX}</span>
          </>
        }
        error={errors.justification?.message}
        {...justificationField}
      />
      {errors.root?.message && (
        <p role="alert" className="text-sm font-medium text-danger">
          {errors.root.message}
        </p>
      )}
      <div>
        <Button type="submit" loading={create.isPending}>
          {t('enviar')}
        </Button>
      </div>
    </form>
  );
}

function RequestSummary({ request }: { request: OrganizerRequest }) {
  const t = useT(messages, 'OrganizerRequestSection');
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {request.status === 'PENDING' && <StatusPill status="IN_REVIEW" />}
        {request.status === 'REJECTED' && <StatusPill status="REJECTED" label={t('recusado')} />}
        {request.status === 'APPROVED' && <StatusPill status="APPROVED" />}
        <span className="text-sm text-muted">{t('enviadoEm', { data: formatDate(request.createdAt) })}</span>
      </div>
      <blockquote className="rounded-md border-l-4 border-border-strong bg-surface-2 px-3 py-2 text-sm text-text [overflow-wrap:anywhere]">{request.justification}</blockquote>
    </div>
  );
}

/** "Quero ser organizador": formulário com justificativa e o status do pedido mais recente (PAR-13). */
export function OrganizerRequestSection() {
  const request = useOrganizerRequest();
  const t = useT(messages, 'OrganizerRequestSection');

  if (request.isPending) {
    return (
      <div className="flex flex-col gap-3" role="status" aria-label={t('carregando')}>
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-10 w-36" />
      </div>
    );
  }
  if (request.isError) {
    return <ErrorState title={t('erroCarregar')} description={errorMessage(request.error)} onRetry={() => void request.refetch()} />;
  }

  const current = request.data;
  if (!current) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">{t('intro')}</p>
        <RequestForm />
      </div>
    );
  }
  if (current.status === 'PENDING') {
    return (
      <div className="flex flex-col gap-3">
        <RequestSummary request={current} />
        <p className="text-sm text-muted">{t('pendente')}</p>
      </div>
    );
  }
  if (current.status === 'APPROVED') {
    return (
      <div className="flex flex-col gap-3">
        <RequestSummary request={current} />
        <p className="text-sm text-muted">{t('aprovado')}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <RequestSummary request={current} />
      <p className="text-sm text-text">
        <strong>{t('motivoRecusa')}</strong> {current.reviewReason ?? t('semMotivo')}
      </p>
      <p className="text-sm text-muted">{t('novoPedido')}</p>
      <RequestForm />
    </div>
  );
}
