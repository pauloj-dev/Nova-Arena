'use client';

import { DELETE_ACCOUNT_PHRASE, type DeletionCheck } from '@nova/schemas';
import { Badge, Button, Card, ErrorState, Input, Modal, Skeleton, useToast } from '@nova/ui';
import { AlertTriangle, CheckCircle2, Cookie, Download, Loader2, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useDataExports, useDeleteAccount, useDeletionCheck, useRequestExport } from '@/shared/api/hooks/privacy';
import { useT } from '@/shared/i18n/react';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { formatDateTime } from '@/shared/lib/datetime';
import { reopenConsent, useConsent } from '@/shared/privacy/consent';
import { messages } from './messages';

function ExportSection() {
  const t = useT(messages, 'ExportSection');
  const toast = useToast();
  const request = useRequestExport();
  const exports = useDataExports();
  const [queued, setQueued] = useState(false);
  return (
    <section aria-labelledby="privacidade-exportar" className="flex flex-col gap-3">
      <h2 id="privacidade-exportar" className="text-lg">
        {t('titulo')}
      </h2>
      <p className="text-sm text-muted">{t('descricao')}</p>
      <Button
        className="self-start"
        loading={request.isPending}
        iconLeft={<Download className="size-4" aria-hidden />}
        onClick={() =>
          request.mutate(undefined, {
            onSuccess: (result) => {
              if ('format' in result) toast.success(t('baixadoTitulo'), t('baixadoDescricao'));
              else {
                setQueued(true);
                toast.success(t('preparandoTitulo'), t('preparandoDescricao'));
              }
            },
            onError: (error) => toast.error(t('erro'), errorMessage(error)),
          })
        }
      >
        {t('baixar')}
      </Button>
      {queued && (
        <p role="status" className="flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {t('naFila')}
        </p>
      )}
      {exports.data && exports.data.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label={t('arquivos')}>
          {exports.data.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span>{t('pedidoEm', { data: formatDateTime(item.createdAt) })}</span>
              {item.status === 'READY' && item.downloadUrl ? (
                <a href={item.downloadUrl} className="inline-flex min-h-11 items-center gap-1 font-medium text-primary-text underline md:min-h-8" download>
                  <Download className="size-4" aria-hidden />
                  {t('baixarAte', { data: formatDateTime(item.expiresAt) })}
                </a>
              ) : item.status === 'PENDING' ? (
                <Badge tone="info">{t('emPreparacao')}</Badge>
              ) : (
                <Badge tone="danger" icon={<AlertTriangle className="size-3.5" aria-hidden />}>
                  {t('falhou')}
                </Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Blockers({ check }: { check: DeletionCheck }) {
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-md border border-warning bg-warning-soft p-3 text-sm text-warning-soft-text">
      {check.blockers.map((blocker) => (
        <div key={blocker.code} className="flex flex-col gap-1">
          <p className="flex items-start gap-2 font-medium">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {blocker.message}
          </p>
          {blocker.items.length > 0 && (
            <ul className="ml-6 list-disc">
              {blocker.items.map((item) => (
                <li key={`${item.label}-${item.href}`}>
                  {item.href ? (
                    <Link href={item.href} className="underline">
                      {item.label}
                    </Link>
                  ) : (
                    item.label
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function DeleteSection() {
  const t = useT(messages, 'DeleteSection');
  const toast = useToast();
  const router = useRouter();
  const check = useDeletionCheck();
  const remove = useDeleteAccount();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [phrase, setPhrase] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (!open && (password || phrase || Object.keys(errors).length > 0)) {
    setPassword('');
    setPhrase('');
    setErrors({});
  }
  const phraseOk = phrase.trim().toUpperCase() === DELETE_ACCOUNT_PHRASE;

  function confirm() {
    remove.mutate(
      { password: check.data?.hasPassword ? password : undefined, confirmation: phrase },
      {
        onSuccess: () => {
          setOpen(false);
          toast.success(t('excluidaTitulo'), t('excluidaDescricao'));
          router.replace('/');
        },
        onError: (error) => {
          if (error instanceof ApiError && Object.keys(error.fieldErrors).length > 0) setErrors(error.fieldErrors);
          else toast.error(t('erro'), errorMessage(error));
        },
      },
    );
  }

  return (
    <section aria-labelledby="privacidade-excluir" className="flex flex-col gap-3">
      <h2 id="privacidade-excluir" className="text-lg">
        {t('titulo')}
      </h2>
      <div className="text-sm text-muted">
        <p>{t('oQueAcontece')}</p>
        <ul className="ml-5 list-disc">
          <li>{t('item1')}</li>
          <li>{t('item2')}</li>
          <li>{t('item3')}</li>
          <li>{t('item4')}</li>
          <li>{t('item5')}</li>
        </ul>
      </div>
      {check.isPending ? (
        <Skeleton className="h-11 w-48" />
      ) : check.isError ? (
        <ErrorState description={errorMessage(check.error)} onRetry={() => void check.refetch()} />
      ) : (
        <>
          {!check.data.canDelete && <Blockers check={check.data} />}
          <Button variant="danger" className="self-start" disabled={!check.data.canDelete} onClick={() => setOpen(true)} iconLeft={<Trash2 className="size-4" aria-hidden />}>
            {t('excluir')}
          </Button>
        </>
      )}
      <Modal
        open={open}
        onOpenChange={(next) => {
          if (!next && remove.isPending) return;
          setOpen(next);
        }}
        title={t('modalTitulo')}
        description={t('modalDescricao')}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={remove.isPending}>
              {t('voltar')}
            </Button>
            <Button variant="danger" loading={remove.isPending} disabled={!phraseOk || (check.data?.hasPassword && !password)} onClick={confirm}>
              {t('excluirParaSempre')}
            </Button>
          </>
        }
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (phraseOk) confirm();
          }}
        >
          {check.data?.hasPassword && <Input label={t('suaSenha')} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} required />}
          <Input
            label={t('digiteFrase', { frase: DELETE_ACCOUNT_PHRASE })}
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            error={errors.confirmation}
            autoComplete="off"
            autoCapitalize="characters"
            required
          />
        </form>
      </Modal>
    </section>
  );
}

function ConsentSection() {
  const t = useT(messages, 'ConsentSection');
  const consent = useConsent();
  return (
    <section aria-labelledby="privacidade-cookies" className="flex flex-col gap-3">
      <h2 id="privacidade-cookies" className="text-lg">
        {t('titulo')}
      </h2>
      <p className="text-sm text-muted">{t('descricao')}</p>
      <p className="flex items-center gap-2 text-sm" role="status">
        {consent?.analytics ? <CheckCircle2 className="size-4 text-primary-text" aria-hidden /> : <Cookie className="size-4" aria-hidden />}
        {consent === undefined ? t('carregando') : consent === null ? t('semEscolha') : consent.analytics ? t('ligada') : t('desligada')}
      </p>
      <Button variant="secondary" className="self-start" onClick={() => reopenConsent()}>
        {t('mudar')}
      </Button>
    </section>
  );
}

/** `/minha-conta/privacidade` (LGPD, issue #115): baixar os dados, excluir a conta e a escolha de cookies. */
export function PrivacyPage() {
  const t = useT(messages, 'PrivacyPage');
  const questions = t.rich('duvidas', {
    link: (chunks) => (
      <Link href="/privacidade" className="underline">
        {chunks}
      </Link>
    ),
  });
  return (
    <PageContainer>
      <PageHeader title={t('titulo')} description={t('descricao')} />
      <div className="flex max-w-3xl flex-col gap-6">
        <Card>
          <ExportSection />
        </Card>
        <Card>
          <ConsentSection />
        </Card>
        <Card>
          <DeleteSection />
        </Card>
        <p className="text-sm text-muted">{questions}</p>
      </div>
    </PageContainer>
  );
}
