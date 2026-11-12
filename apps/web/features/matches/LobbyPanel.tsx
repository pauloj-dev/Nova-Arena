'use client';

import type { Match } from '@nova/schemas';
import { Button, cn, Skeleton, useToast } from '@nova/ui';
import { Copy, KeyRound } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { ApiError } from '@/shared/api/client';
import { useMatchLobby } from '@/shared/api/hooks/competition';
import { formatTime } from '@/shared/lib/datetime';

export interface LobbyPanelProps {
  match: Pick<Match, 'id' | 'hasLobby' | 'status' | 'checkInOpensAt'>;
  className?: string;
}

/** Por que a sala ainda não apareceu, em linguagem de jogador. Nunca é um erro vermelho. */
export function lobbyWaitingText(error: unknown, checkInOpensAt: string | null): { text: string; retry: boolean } {
  if (error instanceof ApiError) {
    if (error.code === 'LOBBY_NOT_SET') return { text: 'A organização ainda não informou a sala. Ela aparece aqui perto do horário da partida.', retry: false };
    if (error.code === 'LOBBY_NOT_REVEALED') {
      return { text: checkInOpensAt ? `A sala aparece aqui perto do horário: ela é liberada às ${formatTime(checkInOpensAt)}.` : 'A sala aparece aqui perto do horário da partida.', retry: false };
    }
    if (error.status === 401 || error.status === 403) return { text: 'A sala aparece aqui perto do horário, só para quem está na partida.', retry: false };
  }
  return { text: 'Não deu para buscar a sala agora. Ela aparece aqui perto do horário da partida.', retry: true };
}

/**
 * "Sala da partida": código e senha, só para quem está na partida (a API é quem decide).
 * Enquanto a sala não foi informada ou liberada, mostra um aviso neutro em vez de erro.
 */
export function LobbyPanel({ match, className }: LobbyPanelProps) {
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

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      success(`${what} copiad${what === 'Senha' ? 'a' : 'o'}`);
    } catch {
      error('Não foi possível copiar', 'Selecione o texto e copie manualmente.');
    }
  }

  const waiting = lobby.isError ? lobbyWaitingText(lobby.error, match.checkInOpensAt) : null;
  const data = lobby.data;

  return (
    <section aria-labelledby={titleId} className={cn('flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3 text-sm', className)} data-testid="lobby-panel">
      <h4 id={titleId} className="flex items-center gap-1.5 text-sm">
        <KeyRound className="size-4 shrink-0 text-muted" aria-hidden />
        Sala da partida
      </h4>
      {lobby.isPending ? (
        <div role="status" aria-label="Carregando a sala">
          <Skeleton className="h-11 w-full" />
        </div>
      ) : waiting ? (
        <div className="flex flex-col gap-2">
          <p className="text-muted">{waiting.text}</p>
          {waiting.retry && (
            <Button variant="secondary" size="sm" className="self-start" loading={lobby.isFetching} onClick={() => void lobby.refetch()}>
              Tentar de novo
            </Button>
          )}
        </div>
      ) : data ? (
        <dl className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <dt className="text-xs text-muted">Código</dt>
              <dd className="tabular break-all text-base" data-testid="lobby-code">
                {data.code}
              </dd>
            </div>
            <Button variant="secondary" size="sm" iconLeft={<Copy className="size-4" aria-hidden />} onClick={() => void copy(data.code, 'Código')} aria-label="Copiar código da sala">
              Copiar
            </Button>
          </div>
          {data.password && (
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <dt className="text-xs text-muted">Senha</dt>
                <dd className="tabular break-all text-base" data-testid="lobby-password">
                  {data.password}
                </dd>
              </div>
              <Button variant="secondary" size="sm" iconLeft={<Copy className="size-4" aria-hidden />} onClick={() => void copy(data.password ?? '', 'Senha')} aria-label="Copiar senha da sala">
                Copiar
              </Button>
            </div>
          )}
          <p className="text-xs text-muted">Só quem está nesta partida vê a sala. Não compartilhe.</p>
        </dl>
      ) : null}
    </section>
  );
}
