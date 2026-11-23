'use client';

import type { DiscordLinkCode, DiscordLinkStatus } from '@nova/schemas';
import { Badge, Button, Card, ConfirmDestructive, ErrorState, Skeleton, useToast } from '@nova/ui';
import { AlertTriangle, BellRing, Bot, CheckCircle2, Clock, Copy, ExternalLink, FlaskConical, Hash, KeyRound, Link2Off, Send, Unplug } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useCreateDiscordCode, useDiscordLink, useSimulateDiscordLink, useTestDiscord, useUnlinkDiscord } from '@/shared/api/hooks/discord';
import { isModuleMocked } from '@/shared/api/mode';
import { useT } from '@/shared/i18n/react';
import { formatDateTime, formatTime } from '@/shared/lib/datetime';
import { messages } from './messages';

const ANNOUNCEMENTS = ['partida', 'resultado', 'chave', 'campeao'] as const;

function CodeCard({ code, tournamentId, onUsed }: { code: DiscordLinkCode; tournamentId: string; onUsed: () => void }) {
  const t = useT(messages, 'DiscordCodeCard');
  const { success, error } = useToast();
  const simulate = useSimulateDiscordLink(tournamentId);
  const prototype = isModuleMocked('discord');

  async function copy() {
    try {
      await navigator.clipboard.writeText(code.command);
      success(t('copiado'), t('copiadoDescricao'));
    } catch {
      error(t('erroCopiar'), t('erroCopiarDescricao'));
    }
  }

  const instructions = t.rich('instrucao', { hora: formatTime(code.expiresAt), strong: (chunks) => <strong>{chunks}</strong> });
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-accent bg-accent-soft p-3 text-accent-soft-text" data-testid="discord-code">
      <p className="text-sm">
        {instructions}
      </p>
      <code className="tabular block rounded-md bg-surface px-3 py-2 text-base font-semibold break-all text-text" aria-label={t('comandoRotulo')}>
        {code.command}
      </code>
      <div className="flex flex-col gap-2 xs:flex-row xs:flex-wrap">
        <Button variant="secondary" size="sm" iconLeft={<Copy className="size-4" aria-hidden />} onClick={() => void copy()}>
          {t('copiar')}
        </Button>
        {prototype && (
          <Button
            size="sm"
            iconLeft={<FlaskConical className="size-4" aria-hidden />}
            loading={simulate.isPending}
            onClick={() =>
              simulate.mutate(code.code, {
                onSuccess: (r) => {
                  success(t('simulado'), r.data?.content.replace(/\*\*/g, '') ?? t('pronto'));
                  onUsed();
                },
                onError: (e) => error(t('erroSimular'), errorMessage(e)),
              })
            }
          >
            {t('simular')}
          </Button>
        )}
      </div>
      {prototype && <p className="text-xs">{t('prototipo')}</p>}
    </div>
  );
}

function ActiveLink({ status, tournamentId, onNewCode, generating }: { status: DiscordLinkStatus; tournamentId: string; onNewCode: () => void; generating: boolean }) {
  const t = useT(messages, 'DiscordActiveLink');
  const { success, error } = useToast();
  const test = useTestDiscord(tournamentId);
  const unlink = useUnlinkDiscord(tournamentId);
  const [confirming, setConfirming] = useState(false);
  const server = status.guildName ?? t('servidorPadrao');
  const lastError = status.lastError ? t.rich('erroAviso', { erro: status.lastError, strong: (chunks) => <strong>{chunks}</strong> }) : null;

  return (
    <Card className="flex flex-col gap-4" data-testid="discord-active">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg">{server}</h3>
        <Badge tone="primary" icon={<CheckCircle2 className="size-3.5" aria-hidden />}>
          {t('vinculado')}
        </Badge>
      </div>
      <dl className="grid gap-x-6 gap-y-2 text-sm xs:grid-cols-2">
        <div>
          <dt className="text-muted">{t('canal')}</dt>
          <dd className="flex items-center gap-1 font-medium text-text">
            <Hash className="size-4 text-muted" aria-hidden />
            <span className="tabular break-all">{status.channelId}</span>
          </dd>
        </div>
        <div>
          <dt className="text-muted">{t('vinculadoPor')}</dt>
          <dd className="font-medium text-text">
            {status.linkedByNickname ?? '—'}
            {status.linkedAt && <span className="font-normal text-muted"> · {formatDateTime(status.linkedAt)}</span>}
          </dd>
        </div>
        <div>
          <dt className="text-muted">{t('ultimoAviso')}</dt>
          <dd className="font-medium text-text">{status.lastAnnouncementAt ? formatDateTime(status.lastAnnouncementAt) : t('nenhumAinda')}</dd>
        </div>
      </dl>
      {status.lastError && (
        <p role="alert" className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-soft-text">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {lastError}
          </span>
        </p>
      )}
      <div className="flex flex-col gap-2 xs:flex-row xs:flex-wrap">
        <Button
          variant="secondary"
          iconLeft={<Send className="size-4" aria-hidden />}
          loading={test.isPending}
          onClick={() => test.mutate(undefined, { onSuccess: () => success(t('testeEnviado'), t('testeEnviadoDescricao')), onError: (e) => error(t('erroTeste'), errorMessage(e)) })}
        >
          {t('enviarTeste')}
        </Button>
        <Button variant="secondary" iconLeft={<KeyRound className="size-4" aria-hidden />} loading={generating} onClick={onNewCode}>
          {t('trocarCanal')}
        </Button>
        <Button variant="danger" iconLeft={<Unplug className="size-4" aria-hidden />} onClick={() => setConfirming(true)}>
          {t('desvincular')}
        </Button>
      </div>
      <ConfirmDestructive
        open={confirming}
        onOpenChange={setConfirming}
        title={t('desvincularTitulo')}
        description={t('desvincularDescricao')}
        confirmText={t('desvincularPalavra')}
        confirmLabel={t('desvincular')}
        loading={unlink.isPending}
        onConfirm={() =>
          unlink.mutate(undefined, {
            onSuccess: () => {
              setConfirming(false);
              success(t('desvinculado'));
            },
            onError: (e) => error(t('erroDesvincular'), errorMessage(e)),
          })
        }
      />
    </Card>
  );
}

/**
 * Aba Discord da operação (issue 121): liga o campeonato a um canal de um servidor do Discord. O bot avisa no canal
 * (partida em 15 min, resultado, chave, campeão) e os jogadores fazem check-in e consultam a próxima partida por
 * comando. Só a organização que gerencia (dono, co-organizador, Admin) vê esta aba.
 */
export function DiscordTab({ tournamentId }: { tournamentId: string }) {
  const t = useT(messages, 'DiscordTab');
  const query = useDiscordLink(tournamentId);
  const create = useCreateDiscordCode(tournamentId);
  const { error } = useToast();
  const [code, setCode] = useState<DiscordLinkCode | null>(null);

  function generate() {
    create.mutate(undefined, { onSuccess: setCode, onError: (e) => error(t('erroGerar'), errorMessage(e)) });
  }

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-3" role="status" aria-label={t('carregando')}>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (query.error) return <ErrorState title={t('erroCarregar')} description={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  const status = query.data;
  const commands = t.rich('comandos', { code: (chunks) => <code className="text-text">{chunks}</code> });
  const visibleCode = code && code.expiresAt > new Date().toISOString() && status.state !== 'NONE' ? code : null;

  return (
    <div className="flex flex-col gap-5" data-testid="discord-tab">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-xl">
          <Bot className="size-5 text-muted" aria-hidden />
          {t('titulo')}
        </h2>
        <p className="text-sm text-muted">{t('descricao')}</p>
      </div>

      {!status.enabled ? (
        <Card className="flex items-start gap-3" data-testid="discord-disabled">
          <Link2Off className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
          <div className="flex flex-col gap-1">
            <h3 className="text-base">{t('inativoTitulo')}</h3>
            <p className="text-sm text-muted">{t('inativoDescricao')}</p>
          </div>
        </Card>
      ) : status.state === 'ACTIVE' ? (
        <>
          <ActiveLink status={status} tournamentId={tournamentId} onNewCode={generate} generating={create.isPending} />
          {visibleCode && <CodeCard code={visibleCode} tournamentId={tournamentId} onUsed={() => setCode(null)} />}
        </>
      ) : (
        <Card className="flex flex-col gap-4" data-testid="discord-setup">
          <h3 className="text-lg">{t('vincularTitulo')}</h3>
          <ol className="flex flex-col gap-3 text-sm text-text">
            <li className="flex gap-2">
              <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-bold">1</span>
              <span className="flex flex-col gap-2">
                {t('passo1')}
                {status.installUrl && (
                  <Button asChild variant="secondary" size="sm" className="self-start">
                    <a href={status.installUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="size-4" aria-hidden />
                      {t('adicionarBot')}
                      <span className="sr-only">{t('abreOutraAba')}</span>
                    </a>
                  </Button>
                )}
              </span>
            </li>
            <li className="flex gap-2">
              <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-bold">2</span>
              <span>{t('passo2')}</span>
            </li>
          </ol>
          {status.state === 'PENDING' && !visibleCode && status.codeExpiresAt && (
            <p role="status" className="flex items-center gap-2 text-sm text-muted">
              <Clock className="size-4 shrink-0" aria-hidden />
              {t('codigoAberto', { hora: formatTime(status.codeExpiresAt) })}
            </p>
          )}
          {visibleCode ? (
            <CodeCard code={visibleCode} tournamentId={tournamentId} onUsed={() => setCode(null)} />
          ) : (
            <Button className="self-start" iconLeft={<KeyRound className="size-4" aria-hidden />} loading={create.isPending} onClick={generate}>
              {t('gerarCodigo')}
            </Button>
          )}
        </Card>
      )}

      <Card className="flex flex-col gap-3">
        <h3 className="flex items-center gap-2 text-base">
          <BellRing className="size-4 text-muted" aria-hidden />
          {t('oQueFaz')}
        </h3>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-text">
          {ANNOUNCEMENTS.map((a) => (
            <li key={a}>{t(`avisos.${a}`)}</li>
          ))}
        </ul>
        <p className="text-sm text-muted">
          {commands}
        </p>
      </Card>
    </div>
  );
}
