'use client';

import type { DiscordLinkCode, DiscordLinkStatus } from '@nova/schemas';
import { Badge, Button, Card, ConfirmDestructive, ErrorState, Skeleton, useToast } from '@nova/ui';
import { AlertTriangle, BellRing, Bot, CheckCircle2, Clock, Copy, ExternalLink, FlaskConical, Hash, KeyRound, Link2Off, Send, Unplug } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useCreateDiscordCode, useDiscordLink, useSimulateDiscordLink, useTestDiscord, useUnlinkDiscord } from '@/shared/api/hooks/discord';
import { isModuleMocked } from '@/shared/api/mode';
import { formatDateTime, formatTime } from '@/shared/lib/datetime';

const ANNOUNCEMENTS = ['Partida em 15 minutos (com o atalho do check-in)', 'Resultado lançado, corrigido ou W.O.', 'Chave confirmada e nova fase', 'Campeão e pódio no encerramento'];

function CodeCard({ code, tournamentId, onUsed }: { code: DiscordLinkCode; tournamentId: string; onUsed: () => void }) {
  const { success, error } = useToast();
  const simulate = useSimulateDiscordLink(tournamentId);
  const prototype = isModuleMocked('discord');

  async function copy() {
    try {
      await navigator.clipboard.writeText(code.command);
      success('Comando copiado', 'Cole no canal do Discord que vai receber os avisos.');
    } catch {
      error('Não foi possível copiar', 'Selecione o comando e copie.');
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-accent bg-accent-soft p-3 text-accent-soft-text" data-testid="discord-code">
      <p className="text-sm">
        No canal do Discord que vai receber os avisos, digite o comando abaixo. O código vale até <strong>{formatTime(code.expiresAt)}</strong> e só pode ser usado uma vez.
      </p>
      <code className="tabular block rounded-md bg-surface px-3 py-2 text-base font-semibold break-all text-text" aria-label="Comando para o Discord">
        {code.command}
      </code>
      <div className="flex flex-col gap-2 xs:flex-row xs:flex-wrap">
        <Button variant="secondary" size="sm" iconLeft={<Copy className="size-4" aria-hidden />} onClick={() => void copy()}>
          Copiar comando
        </Button>
        {prototype && (
          <Button
            size="sm"
            iconLeft={<FlaskConical className="size-4" aria-hidden />}
            loading={simulate.isPending}
            onClick={() =>
              simulate.mutate(code.code, {
                onSuccess: (r) => {
                  success('Comando simulado', r.data?.content.replace(/\*\*/g, '') ?? 'Pronto.');
                  onUsed();
                },
                onError: (e) => error('Não foi possível simular', errorMessage(e)),
              })
            }
          >
            Simular o comando no protótipo
          </Button>
        )}
      </div>
      {prototype && <p className="text-xs">Protótipo: não há Discord aqui. A simulação faz o papel de um servidor de demonstração, com você como quem digitou o comando.</p>}
    </div>
  );
}

function ActiveLink({ status, tournamentId, onNewCode, generating }: { status: DiscordLinkStatus; tournamentId: string; onNewCode: () => void; generating: boolean }) {
  const { success, error } = useToast();
  const test = useTestDiscord(tournamentId);
  const unlink = useUnlinkDiscord(tournamentId);
  const [confirming, setConfirming] = useState(false);
  const server = status.guildName ?? 'Servidor do Discord';

  return (
    <Card className="flex flex-col gap-4" data-testid="discord-active">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg">{server}</h3>
        <Badge tone="primary" icon={<CheckCircle2 className="size-3.5" aria-hidden />}>
          Vinculado
        </Badge>
      </div>
      <dl className="grid gap-x-6 gap-y-2 text-sm xs:grid-cols-2">
        <div>
          <dt className="text-muted">Canal dos avisos</dt>
          <dd className="flex items-center gap-1 font-medium text-text">
            <Hash className="size-4 text-muted" aria-hidden />
            <span className="tabular break-all">{status.channelId}</span>
          </dd>
        </div>
        <div>
          <dt className="text-muted">Vinculado por</dt>
          <dd className="font-medium text-text">
            {status.linkedByNickname ?? '—'}
            {status.linkedAt && <span className="font-normal text-muted"> · {formatDateTime(status.linkedAt)}</span>}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Último aviso entregue</dt>
          <dd className="font-medium text-text">{status.lastAnnouncementAt ? formatDateTime(status.lastAnnouncementAt) : 'Nenhum ainda'}</dd>
        </div>
      </dl>
      {status.lastError && (
        <p role="alert" className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-soft-text">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <strong>O último aviso não chegou.</strong> {status.lastError} Confira as permissões do bot no canal ou gere um novo código para usar outro canal.
          </span>
        </p>
      )}
      <div className="flex flex-col gap-2 xs:flex-row xs:flex-wrap">
        <Button
          variant="secondary"
          iconLeft={<Send className="size-4" aria-hidden />}
          loading={test.isPending}
          onClick={() => test.mutate(undefined, { onSuccess: () => success('Aviso de teste enviado', 'Ele aparece no canal em alguns segundos.'), onError: (e) => error('Não foi possível enviar o aviso', errorMessage(e)) })}
        >
          Enviar aviso de teste
        </Button>
        <Button variant="secondary" iconLeft={<KeyRound className="size-4" aria-hidden />} loading={generating} onClick={onNewCode}>
          Trocar de canal
        </Button>
        <Button variant="danger" iconLeft={<Unplug className="size-4" aria-hidden />} onClick={() => setConfirming(true)}>
          Desvincular
        </Button>
      </div>
      <ConfirmDestructive
        open={confirming}
        onOpenChange={setConfirming}
        title="Desvincular o Discord?"
        description="O canal para de receber os avisos deste campeonato e os comandos deixam de olhar para ele. Dá para vincular de novo depois."
        confirmText="desvincular"
        confirmLabel="Desvincular"
        loading={unlink.isPending}
        onConfirm={() =>
          unlink.mutate(undefined, {
            onSuccess: () => {
              setConfirming(false);
              success('Discord desvinculado');
            },
            onError: (e) => error('Não foi possível desvincular', errorMessage(e)),
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
  const query = useDiscordLink(tournamentId);
  const create = useCreateDiscordCode(tournamentId);
  const { error } = useToast();
  const [code, setCode] = useState<DiscordLinkCode | null>(null);

  function generate() {
    create.mutate(undefined, { onSuccess: setCode, onError: (e) => error('Não foi possível gerar o código', errorMessage(e)) });
  }

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-3" role="status" aria-label="Carregando o Discord">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (query.error) return <ErrorState title="Não foi possível carregar o vínculo com o Discord" description={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  const status = query.data;
  const visibleCode = code && code.expiresAt > new Date().toISOString() && status.state !== 'NONE' ? code : null;

  return (
    <div className="flex flex-col gap-5" data-testid="discord-tab">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-xl">
          <Bot className="size-5 text-muted" aria-hidden />
          Bot do Discord
        </h2>
        <p className="text-sm text-muted">Avisos automáticos no servidor da sua comunidade e check-in por comando, sem ninguém precisar abrir o site.</p>
      </div>

      {!status.enabled ? (
        <Card className="flex items-start gap-3" data-testid="discord-disabled">
          <Link2Off className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
          <div className="flex flex-col gap-1">
            <h3 className="text-base">O bot do Discord não está ativo nesta instalação</h3>
            <p className="text-sm text-muted">Quando a equipe da Nova Arena ligar o bot, você vincula o servidor por aqui. O resto do campeonato funciona normalmente.</p>
          </div>
        </Card>
      ) : status.state === 'ACTIVE' ? (
        <>
          <ActiveLink status={status} tournamentId={tournamentId} onNewCode={generate} generating={create.isPending} />
          {visibleCode && <CodeCard code={visibleCode} tournamentId={tournamentId} onUsed={() => setCode(null)} />}
        </>
      ) : (
        <Card className="flex flex-col gap-4" data-testid="discord-setup">
          <h3 className="text-lg">Vincular um servidor</h3>
          <ol className="flex flex-col gap-3 text-sm text-text">
            <li className="flex gap-2">
              <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-bold">1</span>
              <span className="flex flex-col gap-2">
                Adicione o bot da Nova Arena ao servidor (precisa da permissão “Gerenciar servidor”).
                {status.installUrl && (
                  <Button asChild variant="secondary" size="sm" className="self-start">
                    <a href={status.installUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="size-4" aria-hidden />
                      Adicionar o bot ao Discord
                      <span className="sr-only"> (abre em outra aba)</span>
                    </a>
                  </Button>
                )}
              </span>
            </li>
            <li className="flex gap-2">
              <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-bold">2</span>
              <span>Gere o código de vínculo e digite o comando no canal que vai receber os avisos.</span>
            </li>
          </ol>
          {status.state === 'PENDING' && !visibleCode && status.codeExpiresAt && (
            <p role="status" className="flex items-center gap-2 text-sm text-muted">
              <Clock className="size-4 shrink-0" aria-hidden />
              Há um código em aberto até {formatTime(status.codeExpiresAt)}. Se você não o tem mais, gere outro: o anterior deixa de valer.
            </p>
          )}
          {visibleCode ? (
            <CodeCard code={visibleCode} tournamentId={tournamentId} onUsed={() => setCode(null)} />
          ) : (
            <Button className="self-start" iconLeft={<KeyRound className="size-4" aria-hidden />} loading={create.isPending} onClick={generate}>
              Gerar código de vínculo
            </Button>
          )}
        </Card>
      )}

      <Card className="flex flex-col gap-3">
        <h3 className="flex items-center gap-2 text-base">
          <BellRing className="size-4 text-muted" aria-hidden />O que o bot faz
        </h3>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-text">
          {ANNOUNCEMENTS.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
        <p className="text-sm text-muted">
          Jogadores usam <code className="text-text">/nova-arena checkin</code> e <code className="text-text">/nova-arena proxima</code> com a conta do Discord vinculada à Nova Arena (em Minha conta → Segurança). O bot nunca menciona @everyone.
        </p>
      </Card>
    </div>
  );
}
