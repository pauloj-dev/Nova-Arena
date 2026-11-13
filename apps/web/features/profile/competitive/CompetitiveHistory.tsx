'use client';

import type { CompetitiveStats } from '@nova/schemas';
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton, type BadgeTone } from '@nova/ui';
import { Award, Crown, Flag, Medal, Radio, Star, Swords, Trophy, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { errorMessage } from '@/shared/api/client';
import { useCompetitiveStats } from '@/shared/api/hooks/profile-stats';
import { formatDate } from '@/shared/lib/datetime';

type PerGame = CompetitiveStats['perGame'][number];
type Achievement = CompetitiveStats['achievements'][number];
type HistoryEntry = CompetitiveStats['history'][number];

const ACHIEVEMENTS: Record<Achievement['type'], { icon: LucideIcon; tone: BadgeTone }> = {
  CHAMPION: { icon: Crown, tone: 'gold' },
  RUNNER_UP: { icon: Medal, tone: 'neutral' },
  THIRD_PLACE: { icon: Medal, tone: 'warning' },
  FIRST_TOURNAMENT: { icon: Flag, tone: 'info' },
  TEN_TOURNAMENTS: { icon: Award, tone: 'primary' },
  MVP: { icon: Star, tone: 'accent' },
};

/** "1º lugar", "2º lugar"… ou o texto para quem ainda está jogando. */
export function placementLabel(entry: Pick<HistoryEntry, 'placement' | 'finishedAt'>): string {
  if (entry.finishedAt === null) return 'Em andamento';
  return entry.placement === null ? 'Sem colocação' : `${entry.placement}º lugar`;
}

/** Aproveitamento em partidas: vitórias sobre partidas, em porcentagem inteira. */
export function winRate(wins: number, matches: number): string {
  return matches > 0 ? `${Math.round((wins / matches) * 100)}%` : '—';
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="tabular text-lg font-bold text-text">{value}</dd>
    </div>
  );
}

function GameCard({ game }: { game: PerGame }) {
  return (
    <Card className="min-w-0">
      <article aria-label={`Estatísticas em ${game.gameName}`} className="flex flex-col gap-3">
        <h3 className="flex items-center gap-2 text-base">
          <span aria-hidden className="text-xl leading-none">
            {game.gameIcon}
          </span>
          <span className="min-w-0 [overflow-wrap:anywhere]">{game.gameName}</span>
        </h3>
        <dl className="grid grid-cols-3 gap-x-3 gap-y-3">
          <Stat label="Campeonatos" value={game.tournaments} />
          <Stat label="Títulos" value={game.titles} />
          <Stat label="Partidas" value={game.matches} />
          <Stat label="Vitórias" value={game.wins} />
          <Stat label="Aproveitamento" value={winRate(game.wins, game.matches)} />
          {/* Battle Royale soma kills; duelos somam o placar (gols, coroas, frames). */}
          {game.kills > 0 ? <Stat label="Kills" value={game.kills} /> : <Stat label="Placar somado" value={game.score} />}
        </dl>
      </article>
    </Card>
  );
}

function AchievementBadge({ achievement }: { achievement: Achievement }) {
  const { icon: Icon, tone } = ACHIEVEMENTS[achievement.type];
  return (
    <li className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2">
      <Badge tone={tone} className="size-9 shrink-0 justify-center px-0" aria-hidden>
        <Icon className="size-4.5" />
      </Badge>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-text">{achievement.label}</p>
        <p className="text-xs text-muted [overflow-wrap:anywhere]">
          {achievement.tournamentName ? `${achievement.tournamentName} · ` : ''}
          {formatDate(achievement.awardedAt)}
        </p>
      </div>
    </li>
  );
}

function PlacementBadge({ entry }: { entry: HistoryEntry }) {
  const label = placementLabel(entry);
  if (entry.finishedAt === null) {
    return (
      <Badge tone="primary" icon={<Radio className="size-3.5" aria-hidden />}>
        {label}
      </Badge>
    );
  }
  if (entry.placement === 1) {
    return (
      <Badge tone="gold" icon={<Crown className="size-3.5" aria-hidden />}>
        {label}
      </Badge>
    );
  }
  if (entry.placement === 2 || entry.placement === 3) {
    return (
      <Badge tone={entry.placement === 2 ? 'neutral' : 'warning'} icon={<Medal className="size-3.5" aria-hidden />}>
        {label}
      </Badge>
    );
  }
  return <Badge tone="neutral">{label}</Badge>;
}

export interface CompetitiveHistoryProps {
  nickname: string;
  /** O perfil é de quem está vendo: muda o texto do estado vazio. */
  isMine?: boolean;
}

/** Seção "Histórico competitivo" do perfil público: números por jogo, conquistas e campeonatos com a colocação. */
export function CompetitiveHistory({ nickname, isMine = false }: CompetitiveHistoryProps) {
  const stats = useCompetitiveStats(nickname);

  return (
    <section aria-labelledby="perfil-historico" className="flex flex-col gap-4">
      <h2 id="perfil-historico" className="text-lg">
        Histórico competitivo
      </h2>

      {stats.isPending ? (
        <div className="grid gap-4 md:grid-cols-2" role="status" aria-label="Carregando histórico competitivo">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : stats.isError ? (
        <ErrorState title="Não foi possível carregar o histórico competitivo" description={errorMessage(stats.error)} onRetry={() => void stats.refetch()} />
      ) : stats.data.perGame.length === 0 ? (
        <EmptyState
          icon={<Trophy className="size-7" />}
          title={isMine ? 'Você ainda não disputou campeonatos' : 'Ainda sem campeonatos disputados'}
          description={
            isMine
              ? 'Inscreva-se em um campeonato: suas partidas, vitórias e títulos aparecem aqui assim que a chave for confirmada.'
              : 'Partidas, vitórias e títulos aparecem aqui quando este jogador disputar um campeonato na Nova Arena.'
          }
          action={
            <Button asChild variant="secondary">
              <Link href="/campeonatos?status=open">Ver campeonatos abertos</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {stats.data.perGame.map((game) => (
              <GameCard key={game.gameId} game={game} />
            ))}
          </div>

          {stats.data.achievements.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-base">Conquistas</h3>
              <ul className="grid gap-2 xs:grid-cols-2" aria-label="Conquistas">
                {stats.data.achievements.map((a) => (
                  <AchievementBadge key={a.id} achievement={a} />
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <h3 className="text-base">Campeonatos</h3>
            <Card padding="none">
              <ul className="divide-y divide-border" aria-label="Campeonatos disputados">
                {stats.data.history.map((entry) => (
                  <li key={entry.tournamentId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                    <span aria-hidden className="text-xl leading-none">
                      {entry.gameIcon}
                    </span>
                    <div className="min-w-0 flex-1 basis-40">
                      <Link href={`/c/${entry.tournamentSlug}`} className="text-sm font-semibold text-text underline-offset-2 hover:underline [overflow-wrap:anywhere]">
                        {entry.tournamentName}
                      </Link>
                      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                        {entry.teamName && (
                          <span className="flex items-center gap-1">
                            <Swords className="size-3" aria-hidden />
                            {entry.teamName}
                          </span>
                        )}
                        <span>{entry.finishedAt ? `Encerrado em ${formatDate(entry.finishedAt)}` : 'Ainda em disputa'}</span>
                      </p>
                    </div>
                    <PlacementBadge entry={entry} />
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </>
      )}
    </section>
  );
}
