'use client';

import { DELETE_ACCOUNT_PHRASE, type DeletionCheck } from '@nova/schemas';
import { Badge, Button, Card, ErrorState, Input, Modal, Skeleton, useToast } from '@nova/ui';
import { AlertTriangle, CheckCircle2, Cookie, Download, Loader2, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useDataExports, useDeleteAccount, useDeletionCheck, useRequestExport } from '@/shared/api/hooks/privacy';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { formatDateTime } from '@/shared/lib/datetime';
import { reopenConsent, useConsent } from '@/shared/privacy/consent';

function ExportSection() {
  const toast = useToast();
  const request = useRequestExport();
  const exports = useDataExports();
  const [queued, setQueued] = useState(false);
  return (
    <section aria-labelledby="privacidade-exportar" className="flex flex-col gap-3">
      <h2 id="privacidade-exportar" className="text-lg">
        Baixar meus dados
      </h2>
      <p className="text-sm text-muted">
        Um arquivo JSON com tudo o que a Nova Arena guarda sobre você: conta, IDs de jogo, inscrições, squads, resultados enviados, disputas, denúncias, notificações e aparelhos conectados. Senhas e códigos de segurança nunca entram.
      </p>
      <Button
        className="self-start"
        loading={request.isPending}
        iconLeft={<Download className="size-4" aria-hidden />}
        onClick={() =>
          request.mutate(undefined, {
            onSuccess: (result) => {
              if ('format' in result) toast.success('Arquivo baixado', 'Confira a pasta de downloads do seu aparelho.');
              else {
                setQueued(true);
                toast.success('Estamos preparando o arquivo', 'Você recebe uma notificação quando ele ficar pronto.');
              }
            },
            onError: (error) => toast.error('Não foi possível gerar o arquivo', errorMessage(error)),
          })
        }
      >
        Baixar meus dados
      </Button>
      {queued && (
        <p role="status" className="flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Sua conta tem bastante histórico: o arquivo fica pronto em alguns minutos e aparece aqui.
        </p>
      )}
      {exports.data && exports.data.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Arquivos gerados">
          {exports.data.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span>Pedido em {formatDateTime(item.createdAt)}</span>
              {item.status === 'READY' && item.downloadUrl ? (
                <a href={item.downloadUrl} className="inline-flex min-h-11 items-center gap-1 font-medium text-primary-text underline md:min-h-8" download>
                  <Download className="size-4" aria-hidden />
                  Baixar (até {formatDateTime(item.expiresAt)})
                </a>
              ) : item.status === 'PENDING' ? (
                <Badge tone="info">Em preparação</Badge>
              ) : (
                <Badge tone="danger" icon={<AlertTriangle className="size-3.5" aria-hidden />}>
                  Falhou: peça de novo
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
          toast.success('Sua conta foi excluída', 'Seus dados pessoais foram apagados. Os campeonatos antigos mostram você como “jogador removido”.');
          router.replace('/');
        },
        onError: (error) => {
          if (error instanceof ApiError && Object.keys(error.fieldErrors).length > 0) setErrors(error.fieldErrors);
          else toast.error('Não foi possível excluir a conta', errorMessage(error));
        },
      },
    );
  }

  return (
    <section aria-labelledby="privacidade-excluir" className="flex flex-col gap-3">
      <h2 id="privacidade-excluir" className="text-lg">
        Excluir minha conta
      </h2>
      <div className="text-sm text-muted">
        <p>O que acontece:</p>
        <ul className="ml-5 list-disc">
          <li>Seu e-mail, apelido, foto, bio, redes, data de nascimento, IDs de jogo, aparelhos, notificações e preferências são apagados.</li>
          <li>Seus campeonatos antigos continuam com os resultados, mas você aparece como “jogador removido”.</li>
          <li>Se você era capitão, o membro mais antigo do squad assume.</li>
          <li>Provas de disputas já resolvidas e o registro de auditoria ficam guardados pelo prazo legal, sem seus dados de contato.</li>
          <li>Não dá para desfazer. Se quiser uma cópia, baixe seus dados antes.</li>
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
            Excluir minha conta
          </Button>
        </>
      )}
      <Modal
        open={open}
        onOpenChange={(next) => {
          if (!next && remove.isPending) return;
          setOpen(next);
        }}
        title="Excluir a conta para sempre?"
        description="Seus dados pessoais são apagados e não dá para recuperar a conta."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={remove.isPending}>
              Voltar
            </Button>
            <Button variant="danger" loading={remove.isPending} disabled={!phraseOk || (check.data?.hasPassword && !password)} onClick={confirm}>
              Excluir para sempre
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
          {check.data?.hasPassword && <Input label="Sua senha" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} required />}
          <Input
            label={`Digite ${DELETE_ACCOUNT_PHRASE} para confirmar`}
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
  const consent = useConsent();
  return (
    <section aria-labelledby="privacidade-cookies" className="flex flex-col gap-3">
      <h2 id="privacidade-cookies" className="text-lg">
        Cookies e medição
      </h2>
      <p className="text-sm text-muted">Usamos só cookies necessários (entrar e manter a conta segura). A medição das páginas visitadas é anônima, sem cookies, e depende da sua escolha.</p>
      <p className="flex items-center gap-2 text-sm" role="status">
        {consent?.analytics ? <CheckCircle2 className="size-4 text-primary-text" aria-hidden /> : <Cookie className="size-4" aria-hidden />}
        {consent === undefined ? 'Carregando…' : consent === null ? 'Você ainda não escolheu: só o necessário está ligado.' : consent.analytics ? 'Medição anônima: ligada.' : 'Medição anônima: desligada (só o necessário).'}
      </p>
      <Button variant="secondary" className="self-start" onClick={() => reopenConsent()}>
        Mudar minha escolha
      </Button>
    </section>
  );
}

/** `/minha-conta/privacidade` (LGPD, issue #115): baixar os dados, excluir a conta e a escolha de cookies. */
export function PrivacyPage() {
  return (
    <PageContainer>
      <PageHeader title="Privacidade" description="Seus dados pessoais: leve uma cópia, decida sobre a medição ou exclua a conta." />
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
        <p className="text-sm text-muted">
          Dúvidas sobre os seus dados? Leia a{' '}
          <Link href="/privacidade" className="underline">
            Política de Privacidade
          </Link>
          .
        </p>
      </div>
    </PageContainer>
  );
}
