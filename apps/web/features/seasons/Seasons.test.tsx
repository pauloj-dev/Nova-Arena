import type { SeasonRanking, SubjectRatings } from '@nova/schemas';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileRatingSection } from './ProfileRatingSection';
import { formatDelta, RatingDelta, RatingSparkline } from './RatingBits';
import { SeasonRankingSection } from './SeasonRankingSection';

type Query<T> = { isPending: boolean; isError: boolean; isSuccess: boolean; data: T | undefined; error: unknown; refetch: () => void };
const ok = <T,>(data: T): Query<T> => ({ isPending: false, isError: false, isSuccess: true, data, error: null, refetch: () => undefined });

const state = vi.hoisted(() => ({
  ranking: null as unknown,
  rating: null as unknown,
  flag: true,
  asked: [] as unknown[],
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/shared/flags/useFlag', () => ({ useFlag: () => state.flag }));
vi.mock('@/shared/api/hooks/seasons', () => ({
  useSeasonRanking: (slug: string, params: unknown) => {
    state.asked.push({ slug, params });
    return state.ranking;
  },
  useUserRating: () => state.rating,
}));

const SEASON = { id: 's1', gameId: 'g', gameSlug: '8-ball-pool', gameName: '8 Ball Pool', name: 'Temporada 2026', startsAt: '2026-01-01T03:00:00.000Z', endsAt: '2027-01-01T03:00:00.000Z', status: 'ACTIVE' as const };
const OLD = { ...SEASON, id: 's0', name: 'Temporada 2025', startsAt: '2025-01-01T03:00:00.000Z', endsAt: '2026-01-01T03:00:00.000Z', status: 'ENDED' as const };
const SETTINGS = { initial: 1000, k: 32, provisionalMatches: 5 };
const RANKING: SeasonRanking = {
  game: { id: 'g', slug: '8-ball-pool', name: '8 Ball Pool' },
  season: SEASON,
  seasons: [SEASON, OLD],
  kind: 'PLAYER',
  settings: SETTINGS,
  entries: [
    { position: 1, subjectId: 'u1', name: 'Bianca', tag: null, avatarUrl: null, href: '/u/Bianca', rating: 1048, peak: 1048, played: 3, wins: 3, draws: 0, losses: 0, provisional: true, lastDelta: 16 },
    { position: 2, subjectId: 'u2', name: 'Lia', tag: null, avatarUrl: null, href: null, rating: 990, peak: 1010, played: 6, wins: 3, draws: 1, losses: 2, provisional: false, lastDelta: -12 },
  ],
};

beforeEach(() => {
  state.ranking = ok(RANKING);
  state.rating = ok<SubjectRatings>({ kind: 'PLAYER', subjectId: 'u1', settings: SETTINGS, entries: [] });
  state.flag = true;
  state.asked = [];
});

describe('peças do rating', () => {
  it('variação com sinal, ícone e texto para leitor de tela', () => {
    expect(formatDelta(12)).toBe('+12');
    expect(formatDelta(-8)).toBe('−8');
    expect(formatDelta(0)).toBe('0');
    const { container } = render(<RatingDelta delta={-8} />);
    expect(screen.getByText('caiu 8 pontos de rating')).toHaveClass('sr-only');
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden');
  });

  it('o gráfico é decorativo e desenha um ponto por partida (mais o rating inicial)', () => {
    const { container } = render(<RatingSparkline initial={1000} history={[{ at: SEASON.startsAt, rating: 1016, delta: 16 }, { at: SEASON.startsAt, rating: 1004, delta: -12 }]} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden');
    expect(svg?.querySelector('path')?.getAttribute('d')?.split(/[ML]/).filter(Boolean)).toHaveLength(3);
  });
});

describe('SeasonRankingSection', () => {
  it('mostra a temporada atual, a explicação e a tabela; o jogador vira link para o perfil', () => {
    render(<SeasonRankingSection game={{ slug: '8-ball-pool', name: '8 Ball Pool' }} />);
    expect(screen.getByRole('heading', { name: 'Temporada de 8 Ball Pool' })).toBeInTheDocument();
    expect(screen.getByText(/Todo mundo começa a temporada com 1000 de rating/)).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Temporada Temporada 2026 de 8 Ball Pool: jogadores' });
    expect(within(table).getByRole('link', { name: /Bianca/ })).toHaveAttribute('href', '/u/Bianca');
    expect(within(table).getByText('Provisório')).toBeInTheDocument();
    expect(within(table).getByLabelText('3 vitórias, 1 empates, 2 derrotas')).toBeInTheDocument();
    expect(state.asked.at(-1)).toEqual({ slug: '8-ball-pool', params: { kind: 'PLAYER', season: undefined } });
  });

  it('troca para squads e para outra temporada', () => {
    render(<SeasonRankingSection game={{ slug: '8-ball-pool', name: '8 Ball Pool' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Squads' }));
    expect(screen.getByRole('button', { name: 'Squads' })).toHaveAttribute('aria-pressed', 'true');
    expect(state.asked.at(-1)).toEqual({ slug: '8-ball-pool', params: { kind: 'TEAM', season: undefined } });
    fireEvent.change(screen.getByLabelText('Temporada'), { target: { value: 's0' } });
    expect(state.asked.at(-1)).toEqual({ slug: '8-ball-pool', params: { kind: 'TEAM', season: 's0' } });
  });

  it('estados: carregando, erro, sem temporada e sem partidas', () => {
    state.ranking = { isPending: true, isError: false, isSuccess: false, data: undefined, error: null, refetch: () => undefined };
    const { rerender } = render(<SeasonRankingSection game={{ slug: 'x', name: 'Xadrez' }} />);
    expect(screen.getByRole('status', { name: 'Carregando a tabela da temporada' })).toBeInTheDocument();

    const refetch = vi.fn();
    state.ranking = { isPending: false, isError: true, isSuccess: false, data: undefined, error: new Error('x'), refetch };
    rerender(<SeasonRankingSection game={{ slug: 'x', name: 'Xadrez' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(refetch).toHaveBeenCalled();

    state.ranking = ok({ ...RANKING, season: null, seasons: [] });
    rerender(<SeasonRankingSection game={{ slug: 'x', name: 'Xadrez' }} />);
    expect(screen.getByRole('heading', { name: 'Nenhuma temporada de Xadrez em andamento' })).toBeInTheDocument();

    state.ranking = ok({ ...RANKING, entries: [] });
    rerender(<SeasonRankingSection game={{ slug: 'x', name: 'Xadrez' }} />);
    expect(screen.getByRole('heading', { name: 'Ninguém jogou nesta temporada ainda' })).toBeInTheDocument();
  });
});

describe('ProfileRatingSection', () => {
  it('some com a flag desligada e para quem não jogou na temporada', () => {
    state.flag = false;
    const { container, rerender } = render(<ProfileRatingSection nickname="Bianca" />);
    expect(container).toBeEmptyDOMElement();
    state.flag = true;
    rerender(<ProfileRatingSection nickname="Bianca" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('um cartão por jogo com rating, posição, V/E/D, a lista das últimas partidas e o link da tabela', () => {
    state.rating = ok<SubjectRatings>({
      kind: 'PLAYER',
      subjectId: 'u1',
      settings: SETTINGS,
      entries: [
        {
          game: { id: 'g', slug: '8-ball-pool', name: '8 Ball Pool', icon: '🎱' },
          season: SEASON,
          rating: 1016,
          peak: 1032,
          played: 2,
          wins: 1,
          draws: 0,
          losses: 1,
          provisional: true,
          position: 4,
          history: [
            { at: '2026-03-01T12:00:00.000Z', rating: 1032, delta: 32 },
            { at: '2026-03-02T12:00:00.000Z', rating: 1016, delta: -16 },
          ],
        },
      ],
    });
    render(<ProfileRatingSection nickname="Bianca" />);
    const card = screen.getByRole('article', { name: 'Rating em 8 Ball Pool' });
    expect(within(card).getAllByText('1016')[0]).toHaveClass('text-3xl');
    expect(within(card).getByText('4º')).toBeInTheDocument();
    expect(within(card).getByText('1 / 0 / 1')).toBeInTheDocument();
    expect(within(card).getAllByRole('listitem')).toHaveLength(2);
    expect(within(card).getByRole('link', { name: 'Ver a tabela da temporada' })).toHaveAttribute('href', '/ranking?jogo=8-ball-pool');
  });
});
