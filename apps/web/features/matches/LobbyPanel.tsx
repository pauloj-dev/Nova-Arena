'use client';

import type { Match } from '@nova/schemas';
import { Button, cn, Skeleton, useToast } from '@nova/ui';
import { Copy, KeyRound } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { ApiError } from '@/shared/api/client';
import { useMatchLobby } from '@/shared/api/hooks/competition';
import { getT } from '@/shared/i18n/core';
import { useT } from '@/shared/i18n/react';
import { formatTime } from '@/shared/lib/datetime';
import { messages } from './messages';

export interface LobbyPanelProps {
  match: Pick<Match, 'id' | 'hasLobby' | 'status' | 'checkInOpensAt'>;
  className?: string;
}

/** Por que a sala ainda não apareceu, em linguagem de jogador. Nunca é um erro vermelho. */
export function lobbyWaitingText(error: unknown, checkInOpensAt: string | null): { text: string; retry: boolean } {
  const t = getT(messages, 'LobbyPanel');
  if (error instanceof ApiError) {
    if (error.code === 'LOBBY_NOT_SET') return { text: t('naoInformada'), retry: false };
    if (error.code === 'LOBBY_NOT_REVEALED') {
      return { text: checkInOpensAt ? t('liberadaAs', { hora: formatTime(checkInOpensAt) }) : t('pertoDoHorario'), retry: false };
    }
    if (error.status === 401 || error.status === 403) return { text: t('soParaQuemJoga'), retry: false };
  }
  return { text: t('erroBusca'), retry: true };
}

/**
 * "Sala da partida": código e senha, só para quem está na partida (a API é quem decide).
 * Enquanto a sala não foi informada ou liberada, mostra um aviso neutro em vez de erro.
 */
export function LobbyPanel({ match, className }: LobbyPanelProps) {
  const t = useT(messages, 'LobbyPanel');
  const lobby = useMatchLobby(match.id);
  const { success, error } = useToast();
  const titleId = useId();

  // A sala passa a existir (ou é liberada) quando a organização informa ou quando o check-in abre.
  const { refetch } = lobby;
  const signature = `${match.hasLobby}:${match.status}`;
  const lastSignature = useRef(signature);
  useEffect(() => {
    if (lastSignature.current === signature) return;
    lastSignature.current = signature;
    void refetch();
  }, [signature, refetch]);

  async function copy(text: string, what: 'codigo' | 'senha') {
    try {
      await navigator.clipboard.writeText(text);
      success(what === 'senha' ? t('senhaCopiada') : t('codigoCopiado'));
    } catch {
      error(t('erroCopiar'), t('erroCopiarDescricao'));
    }
  }

  const waiting = lobby.isError ? lobbyWaitingText(lobby.error, match.checkInOpensAt) : null;
  const data = lobby.data;

  return (
    <section aria-labelledby={titleId} className={cn('flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3 text-sm', className)} data-testid="lobby-panel">
      <h4 id={titleId} className="flex items-center gap-1.5 text-sm">
        <KeyRound className="size-4 shrink-0 text-muted" aria-hidden />
        {t('titulo')}
      </h4>
      {lobby.isPending ? (
        <div role="status" aria-label={t('carregando')}>
          <Skeleton className="h-11 w-full" />
        </div>
      ) : waiting ? (
        <div className="flex flex-col gap-2">
          <p className="text-muted">{waiting.text}</p>
          {waiting.retry && (
            <Button variant="secondary" size="sm" className="self-start" loading={lobby.isFetching} onClick={() => void lobby.refetch()}>
              {t('tentarDeNovo')}
            </Button>
          )}
        </div>
      ) : data ? (
        <div className="flex flex-col gap-2">
          {/* Cada par (rótulo, valor, botão de copiar) é um grupo de <dl> com só <dt>/<dd> dentro. */}
          <dl className="flex flex-col gap-2">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2">
              <dt className="text-xs text-muted">{t('codigo')}</dt>
              <dd className="tabular col-start-1 row-start-2 break-all text-base" data-testid="lobby-code">
                {data.code}
              </dd>
              <dd className="col-start-2 row-span-2 row-start-1">
                <Button variant="secondary" size="sm" iconLeft={<Copy className="size-4" aria-hidden />} onClick={() => void copy(data.code, 'codigo')} aria-label={t('copiarCodigo')}>
                  {t('copiar')}
                </Button>
              </dd>
            </div>
            {data.password && (
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2">
                <dt className="text-xs text-muted">{t('senha')}</dt>
                <dd className="tabular col-start-1 row-start-2 break-all text-base" data-testid="lobby-password">
                  {data.password}
                </dd>
                <dd className="col-start-2 row-span-2 row-start-1">
                  <Button variant="secondary" size="sm" iconLeft={<Copy className="size-4" aria-hidden />} onClick={() => void copy(data.password ?? '', 'senha')} aria-label={t('copiarSenha')}>
                    {t('copiar')}
                  </Button>
                </dd>
              </div>
            )}
          </dl>
          <p className="text-xs text-muted">{t('naoCompartilhe')}</p>
        </div>
      ) : null}
    </section>
  );
}
