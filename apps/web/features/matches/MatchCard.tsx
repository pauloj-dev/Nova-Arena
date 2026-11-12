'use client';

import type { Match, MatchParticipant } from '@nova/schemas';
import { Avatar, Badge, Button, Card, cn, StatusPill } from '@nova/ui';
import { CalendarClock, CheckCircle2, ChevronDown, Clock, Trophy } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { MatchResultActions } from '@/features/disputes/MatchResultActions';
import { ReportButton } from '@/features/reports/ReportButton';
import { formatRelative } from '@/shared/lib/datetime';
import { CheckInPanel } from './CheckInPanel';
import { EvidenceGallery } from './EvidenceGallery';
import { LobbyPanel } from './LobbyPanel';
import { bestOfLabel, isConcluded, isOver, matchAriaLabel, MATCH_STATUS_PILL_LABEL, participantOf, resultText, scheduleText, slotText } from './matchText';
import { useNow } from './useNow';
import { useMatchViewer, type MatchViewer } from './viewer';

export interface MatchCardProps {
  match: Match;
  /** Quem está vendo. Sem a prop, lê do `MatchViewerProvider` (visitante se não houver). */
  viewer?: MatchViewer;
  /**
   * `full` (padrão): tudo — check-in, sala, provas e lista da queda aberta.
   * `compact`: cabeçalho, horário e placar, para listas; o resto fica no detalhe.
   */
  variant?: 'full' | 'compact';
  /** Com a prop, o cartão vira um botão que abre o detalhe (o nome acessível é o confronto inteiro). */
  onOpen?: (match: Match) => void;
  /** Nível do título do cartão. Padrão: 3. */
  headingLevel?: 2 | 3 | 4;
  /** Espaço para ações de quem reutiliza o cartão (ex.: organização lançar resultado). */
  footer?: ReactNode;
  className?: string;
}

function SideBadges({ p, mine, checkInOpen, team }: { p: MatchParticipant; mine: boolean; checkInOpen: boolean; team: boolean }) {
  return (
    <>
      {mine && <Badge tone="accent">{team ? 'Seu squad' : 'Você'}</Badge>}
      {p.isBye && <Badge tone="neutral">Bye</Badge>}
      {p.status !== 'ACTIVE' && <StatusPill status={p.status} />}
      {checkInOpen &&
        (p.checkedIn ? (
          <span className="flex items-center gap-1 text-xs font-semibold text-primary-soft-text">
            <CheckCircle2 className="size-3.5" aria-hidden />
            check-in feito
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-muted">
            <Clock className="size-3.5" aria-hidden />
            aguardando check-in
          </span>
        ))}
    </>
  );
}

function DuelSides({ match, viewer }: { match: Match; viewer: MatchViewer }) {
  const checkInOpen = match.status === 'CHECK_IN';
  const team = viewer.registration?.teamId != null;
  return (
    <ul className="flex flex-col gap-1" aria-label="Lados do confronto">
      {match.participants.map((p, i) => {
        const known = p.registrationId !== null;
        const mine = known && p.registrationId === viewer.registration?.id;
        const won = p.isWinner === true;
        return (
          <li key={p.registrationId ?? `vaga-${i}`} className={cn('flex min-h-11 items-center gap-2 rounded-md px-2 py-1.5', mine ? 'bg-accent-soft' : 'bg-surface-2')}>
            {known ? (
              <>
                {p.seed !== null && (
                  <span className="tabular w-5 shrink-0 text-center text-xs text-muted">
                    <span className="sr-only">Cabeça de chave </span>
                    {p.seed}
                  </span>
                )}
                <Avatar name={p.name} src={p.logoUrl} size="sm" className="shrink-0" />
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className={cn('min-w-0 truncate text-sm', won ? 'font-bold' : p.isWinner === false ? 'text-muted' : 'font-medium')}>
                    {p.name}
                    {p.tag && <span className="tabular ml-1 text-xs text-muted">[{p.tag}]</span>}
                  </span>
                  <SideBadges p={p} mine={mine} checkInOpen={checkInOpen} team={team} />
                </div>
                {won && (
                  <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-gold-soft-text">
                    <Trophy className="size-4" aria-hidden />
                    <span className="sr-only">vencedor</span>
                  </span>
                )}
                <span className={cn('tabular w-6 shrink-0 text-right text-base', won ? 'text-text' : 'text-muted')}>
                  {p.score ?? <span aria-hidden>–</span>}
                  {p.score === null && <span className="sr-only">sem placar</span>}
                </span>
              </>
            ) : (
              <span className="text-sm italic text-muted">{slotText(p)}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Equipes de uma queda BR: antes do resultado, a lista da sala; depois, colocação, kills e pontos. */
function LobbyTeams({ match, viewer, defaultOpen }: { match: Match; viewer: MatchViewer; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const listId = useId();
  const played = isConcluded(match);
  const teams = played
    ? [...match.participants].sort((a, b) => (a.placement ?? Number.MAX_SAFE_INTEGER) - (b.placement ?? Number.MAX_SAFE_INTEGER))
    : match.participants;
  const mine = participantOf(match, viewer.registration?.id);
  const booyah = played ? match.participants.find((p) => p.placement === 1) : undefined;

  return (
    <div className="flex flex-col gap-2">
      {booyah && (
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Trophy className="size-4 shrink-0 text-gold-soft-text" aria-hidden />
          Booyah: {booyah.name}
        </p>
      )}
      {mine && played && (
        <p className="rounded-md bg-accent-soft px-2 py-1.5 text-sm text-accent-soft-text">
          {mine.absent ? 'Seu squad não compareceu a esta queda.' : `Seu squad: ${mine.placement ?? '–'}º lugar · ${mine.kills ?? 0} kills · ${mine.points ?? 0} pts`}
        </p>
      )}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        className="relative z-10 flex min-h-11 items-center justify-between gap-2 rounded-md bg-surface-2 px-3 text-left text-sm font-semibold hover:bg-neutral-soft"
      >
        <span>
          {teams.length} {teams.length === 1 ? 'equipe' : 'equipes'} na sala{played ? ' · colocação, kills e pontos' : ''}
        </span>
        <ChevronDown className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      <div id={listId} hidden={!open}>
        {played ? (
          <table className="w-full table-fixed text-sm">
            <caption className="sr-only">Resultado da queda: colocação, kills e pontos de cada equipe</caption>
            <thead>
              <tr className="text-left text-xs text-muted">
                <th scope="col" className="w-10 py-1 font-semibold">
                  Col.
                </th>
                <th scope="col" className="py-1 font-semibold">
                  Equipe
                </th>
                <th scope="col" className="w-12 py-1 text-right font-semibold">
                  Kills
                </th>
                <th scope="col" className="w-12 py-1 text-right font-semibold">
                  Pts
                </th>
              </tr>
            </thead>
            <tbody>
              {teams.map((p, i) => {
                const isMine = p.registrationId !== null && p.registrationId === viewer.registration?.id;
                return (
                  <tr key={p.registrationId ?? i} className={cn('border-t border-border', isMine && 'bg-accent-soft font-semibold')}>
                    <td className="tabular py-1.5">{p.absent ? '–' : `${p.placement ?? '–'}º`}</td>
                    <td className="truncate py-1.5">
                      {p.name}
                      {isMine && <span className="sr-only"> (seu squad)</span>}
                      {p.absent && <span className="ml-1 text-xs text-muted">(ausente)</span>}
                    </td>
                    <td className="tabular py-1.5 text-right">{p.kills ?? 0}</td>
                    <td className="tabular py-1.5 text-right">{p.points ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <ul className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm xs:grid-cols-2" aria-label="Equipes na sala">
            {teams.map((p, i) => {
              const isMine = p.registrationId !== null && p.registrationId === viewer.registration?.id;
              return (
                <li key={p.registrationId ?? i} className={cn('flex items-center gap-1.5 truncate', isMine && 'font-semibold')}>
                  <span className="truncate">{slotText(p)}</span>
                  {isMine && <Badge tone="accent">Seu squad</Badge>}
                  {p.status !== 'ACTIVE' && <StatusPill status={p.status} />}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Cartão de partida com todos os estados do contrato (agendada, check-in, ao vivo, aguardando
 * validação, concluída, em disputa, W.O., cancelada), para duelo e para queda de Battle Royale.
 */
export function MatchCard({ match, viewer: viewerProp, variant = 'full', onOpen, headingLevel = 3, footer, className }: MatchCardProps) {
  const contextViewer = useMatchViewer();
  const viewer = viewerProp ?? contextViewer;
  const now = useNow(30_000, Boolean(match.scheduledAt) && !isOver(match));

  const full = variant === 'full';
  const mine = participantOf(match, viewer.registration?.id);
  const over = isOver(match);
  const concluded = isConcluded(match);
  const playing = Boolean(mine) && viewer.registration?.status === 'CONFIRMED';
  const showLobby = full && !over && (playing || viewer.isStaff === true);
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  const title = [match.groupName, match.roundLabel].filter(Boolean).join(' · ');
  const result = resultText(match);
  const meta = [match.stageName, match.kind === 'DUEL' && match.bestOf > 1 ? `${bestOfLabel(match.bestOf)} (melhor de ${match.bestOf})` : null, match.multiplier > 1 ? `vale ×${match.multiplier.toLocaleString('pt-BR')}` : null].filter(Boolean);

  return (
    <Card padding="sm" className={cn('relative flex h-full flex-col gap-3', mine && 'border-accent', className)} data-testid="match-card" data-match-id={match.id} data-status={match.status}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Heading className="text-base break-words">
            {onOpen ? (
              <button type="button" onClick={() => onOpen(match)} aria-label={`${matchAriaLabel(match, { highlightRegistrationId: viewer.registration?.id })}. Abrir detalhes`} className="text-left after:absolute after:inset-0 after:rounded-lg">
                {title}
              </button>
            ) : (
              title
            )}
          </Heading>
          <p className="text-xs text-muted">{meta.join(' · ')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {mine && <Badge tone="accent">Sua partida</Badge>}
          <StatusPill status={match.status} label={MATCH_STATUS_PILL_LABEL[match.status]} />
        </div>
      </div>

      <p className="flex flex-wrap items-center gap-x-1.5 text-sm">
        <CalendarClock className="size-4 shrink-0 text-muted" aria-hidden />
        <span>{scheduleText(match)}</span>
        {match.scheduledAt && !over && <span className="text-muted">({formatRelative(match.scheduledAt, new Date(now))})</span>}
      </p>
      {match.ifNecessary && !over && <p className="text-xs text-muted">Esta partida só acontece se for necessário (reset da Grande Final).</p>}
      {match.status === 'CANCELLED' && <p className="text-sm text-muted">Esta partida não vai ser jogada.</p>}
      {match.status === 'AWAITING_VALIDATION' && <p className="text-sm text-muted">Resultado enviado. A organização ainda vai validar.</p>}
      {match.status === 'DISPUTED' && <p className="text-sm text-muted">O resultado foi contestado e está em análise pela organização.</p>}

      {match.kind === 'DUEL' ? <DuelSides match={match} viewer={viewer} /> : <LobbyTeams match={match} viewer={viewer} defaultOpen={full} />}

      {match.kind === 'DUEL' && result && (
        <p className="text-sm text-muted">
          <span className="sr-only">Resultado: </span>
          {result.charAt(0).toUpperCase() + result.slice(1)}
          {result.endsWith('.') ? '' : '.'}
        </p>
      )}

      {/* Blocos interativos ficam acima da área clicável do cartão (o botão do título cobre o cartão inteiro). */}
      {full && (
        <div className="relative z-10 flex flex-col gap-3 empty:hidden">
          {playing && <CheckInPanel match={match} viewer={viewer} />}
          {showLobby && <LobbyPanel match={match} />}
          <EvidenceGallery urls={match.evidenceUrls} />
        </div>
      )}

      {playing && (
        <div className="relative z-10 empty:hidden">
          <MatchResultActions match={match} />
        </div>
      )}
      {footer && <div className="relative z-10">{footer}</div>}
      {((onOpen && !full) || concluded) && (
        <div className="relative z-10 mt-auto flex items-center justify-between gap-2">
          {onOpen && !full ? (
            // O título já é o botão acessível do cartão; este é só o atalho visual.
            <Button variant="ghost" size="sm" onClick={() => onOpen(match)} aria-hidden tabIndex={-1}>
              Ver partida
            </Button>
          ) : (
            <span />
          )}
          {concluded && <ReportButton targetType="MATCH" targetId={match.id} targetLabel={`${title}: ${match.participants.map(slotText).slice(0, 2).join(' x ')}`} variant="icon" />}
        </div>
      )}
    </Card>
  );
}
