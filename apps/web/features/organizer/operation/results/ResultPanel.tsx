'use client';

import type { Rule } from '@nova/engine';
import type { Game, Match, OrganizerTournamentDetail, Stage, SubmitResultResponse } from '@nova/schemas';
import { Button, Card, ErrorState, Skeleton, useToast } from '@nova/ui';
import { ArrowLeft, CheckCircle2, History } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useMatchEvents, useSubmitResult } from '@/shared/api/hooks/competition';
import { useTournamentRegistrations } from '@/shared/api/hooks/tournaments';
import { formatDateTime } from '@/shared/lib/datetime';
import { Tip } from '../../onboarding/Tip';
import { BRDropForm } from './BRDropForm';
import { clearDropDraft, type DropMember } from './brDrop';
import { ScoreInput } from './ScoreInput';

const EVENT_LABEL = { ENTERED: 'Resultado lançado', CORRECTED: 'Resultado corrigido', WALKOVER: 'W.O.', REVERTED: 'Resultado desfeito' } as const;

/** Histórico de lançamentos e correções de uma partida (mais recente primeiro). */
export function ResultHistory({ matchId }: { matchId: string }) {
  const query = useMatchEvents(matchId);
  if (query.isPending) return <Skeleton className="h-16 w-full" />;
  if (query.error) return <ErrorState title="Não foi possível carregar o histórico" description={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  if (query.data.length === 0) return <p className="text-sm text-muted">Ainda não há lançamentos nesta partida.</p>;
  return (
    <ol className="flex flex-col gap-2" aria-label="Histórico de lançamentos e correções" data-testid="result-history">
      {query.data.map((event) => (
        <li key={event.id} className="rounded-md border border-border p-3 text-sm">
          <p className="font-semibold text-text">
            {EVENT_LABEL[event.type]} <span className="font-normal text-muted">por {event.actorNickname} · {formatDateTime(event.createdAt)}</span>
          </p>
          <p className="text-text">{event.summary}</p>
          {event.reason && <p className="text-muted">Motivo: {event.reason}</p>}
        </li>
      ))}
    </ol>
  );
}

/** Pontos calculados pelo servidor, com o detalhamento de cada participação (RN-01). */
function ServerPoints({ response }: { response: SubmitResultResponse }) {
  const lobby = response.match.kind === 'LOBBY';
  const rows = lobby ? [...response.results].sort((a, b) => b.points - a.points) : response.results;
  return (
    <Card className="flex flex-col gap-3" data-testid="server-points">
      <h3 className="flex items-center gap-2 text-lg">
        <CheckCircle2 className="size-5 text-primary-soft-text" aria-hidden />
        Resultado salvo
      </h3>
      <p className="text-sm text-muted">Pontos calculados pelo servidor com o modelo de pontuação da fase. A tabela já foi atualizada para todo mundo.</p>
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {rows.map((r) => (
          <li key={r.registrationId} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
            <span className="font-semibold text-text">{r.name}</span>
            <span className="tabular font-bold text-text">
              {r.points.toLocaleString('pt-BR')} {r.points === 1 ? 'pt' : 'pts'}
            </span>
            {r.breakdown.length > 0 && <span className="w-full text-xs text-muted">{r.breakdown.map((b) => b.label).join(' · ')}</span>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export interface ResultPanelProps {
  tournament: OrganizerTournamentDetail;
  match: Match;
  /** Todas as partidas da fase (para saber quantas quedas a sala tem). */
  stageMatches: readonly Match[];
  game: Game | null;
  onClose: () => void;
  onImportCsv?: () => void;
}

/**
 * Lançamento ou correção do resultado de uma partida: escolhe o formulário (duelo ou queda BR),
 * envia com chave de idempotência — a mesma chave é reutilizada se a pessoa reenviar o mesmo
 * formulário depois de um erro de rede — e mostra os pontos que o servidor calculou.
 */
export function ResultPanel({ tournament: t, match, stageMatches, game, onClose, onImportCsv }: ResultPanelProps) {
  const submit = useSubmitResult();
  const { success, error } = useToast();
  const attempt = useRef<{ key: string; payload: string } | null>(null);
  const [saved, setSaved] = useState<SubmitResultResponse | null>(null);
  // Lançar ou corrigir é decidido ao abrir: a partida muda de status depois de salvar, mas a tela continua a mesma.
  const [correction] = useState(() => match.status === 'VALIDATED' || match.status === 'WALKOVER');
  const stage: Stage | undefined = t.stages.find((s) => s.id === match.stageId);
  const killsPerPlayer = Boolean(stage?.config.killsPerPlayer) && match.kind === 'LOBBY';
  const registrations = useTournamentRegistrations(killsPerPlayer ? t.id : undefined);

  const rules = useMemo(() => (game?.scoringModels.find((m) => m.id === stage?.scoringModelId)?.rules ?? []) as Rule[], [game, stage]);
  const dropCount = stageMatches.filter((m) => m.kind === 'LOBBY' && m.groupId === match.groupId).length || 1;
  const members = useMemo(() => {
    const map: Record<string, DropMember[]> = {};
    for (const r of registrations.data ?? []) map[r.id] = r.members.filter((m) => !m.isSub && m.confirmedAt !== null).map((m) => ({ userId: m.userId, nickname: m.nickname }));
    return map;
  }, [registrations.data]);

  function send(input: { entries: Parameters<typeof submit.mutate>[0]['entries']; winnerRegistrationId?: string | null; evidenceUrls: string[]; correctionReason?: string }) {
    const payload = JSON.stringify(input);
    // Mesmo formulário reenviado (ex.: a rede caiu): mesma chave, para o servidor não lançar duas vezes.
    if (attempt.current?.payload !== payload) attempt.current = { key: crypto.randomUUID(), payload };
    submit.mutate(
      { matchId: match.id, key: attempt.current.key, ...input },
      {
        onSuccess: (response) => {
          attempt.current = null;
          if (match.kind === 'LOBBY') clearDropDraft(match.id);
          setSaved(response);
          success(correction ? 'Resultado corrigido' : match.kind === 'LOBBY' ? 'Queda validada' : 'Resultado salvo', 'A tabela foi recalculada.');
        },
        onError: (e) => {
          // Erro de regra (4xx): o formulário mudou de sentido, a próxima tentativa é outro envio.
          if (e instanceof ApiError && e.status < 500) attempt.current = null;
          error('Não foi possível salvar o resultado', errorMessage(e));
        },
      },
    );
  }

  const paused = t.status === 'PAUSED';
  return (
    <section className="flex flex-col gap-4" aria-label="Lançamento de resultado" data-testid="result-panel">
      <div>
        <Button variant="ghost" size="sm" iconLeft={<ArrowLeft className="size-4" aria-hidden />} onClick={onClose}>
          Voltar para as partidas
        </Button>
      </div>
      <Tip id="lancamento" title="Lançar é rápido">
        {match.kind === 'LOBBY'
          ? 'Digite a colocação e as kills e use Tab ou Enter para ir à próxima célula; as setas sobem e descem. Os pontos da prévia são os mesmos que o servidor vai calcular.'
          : 'Digite o placar dos dois lados e salve. Quem vence e os pontos são calculados pelo servidor; o vencedor avança sozinho na chave.'}
      </Tip>
      {paused && (
        <p role="status" className="rounded-md bg-warning-soft px-3 py-2 text-sm font-medium text-warning-soft-text">
          O campeonato está pausado. Retome na aba Resumo para lançar resultados.
        </p>
      )}

      {saved ? (
        <>
          <ServerPoints response={saved} />
          <div className="flex flex-wrap gap-2">
            <Button onClick={onClose}>Voltar para as partidas</Button>
          </div>
        </>
      ) : match.kind === 'LOBBY' ? (
        killsPerPlayer && registrations.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <BRDropForm match={match} rules={rules} dropCount={dropCount} killsPerPlayer={killsPerPlayer} members={members} correction={correction} submitting={submit.isPending} disabled={paused} onSubmit={send} onImportCsv={correction ? undefined : onImportCsv} />
        )
      ) : (
        <ScoreInput match={match} gameSlug={game?.slug} extraStatFields={game?.extraStatFields ?? []} correction={correction} submitting={submit.isPending} disabled={paused} onSubmit={send} />
      )}

      {(correction || saved) && (
        <Card className="flex flex-col gap-3">
          <h3 className="flex items-center gap-2 text-base">
            <History className="size-4 text-muted" aria-hidden />
            Histórico desta partida
          </h3>
          <ResultHistory matchId={match.id} />
        </Card>
      )}
    </section>
  );
}
