import type { CompetitiveStats } from '@nova/schemas';
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CompetitiveHistory, placementLabel, winRate } from './CompetitiveHistory';

const state = vi.hoisted(() => ({ stats: { isPending: false, isError: false, data: undefined as unknown, error: null as unknown, refetch: () => undefined }, asked: [] as string[] }));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/shared/api/hooks/profile-stats', () => ({
  useCompetitiveStats: (nickname: string) => {
    state.asked.push(nickname);
    return state.stats;
  },
}));

const EMPTY: CompetitiveStats = { userId: 'u_x', perGame: [], achievements: [], history: [] };
const FULL: CompetitiveStats = {
  userId: 'u_bianca',
  perGame: [
    { gameId: 'g_8ball', gameName: '8 Ball Pool', gameIcon: '🎱', tournaments: 2, titles: 1, wins: 5, matches: 6, kills: 0, score: 11 },
    { gameId: 'g_ff', gameName: 'Free Fire', gameIcon: '🔥', tournaments: 1, titles: 0, wins: 2, matches: 9, kills: 37, score: 0 },
  ],
  achievements: [
    { id: 'a1', type: 'CHAMPION', label: 'Campeão', tournamentName: 'Open 8 Ball Pool', awardedAt: '2026-10-23T12:00:00.000Z' },
    { id: 'a2', type: 'MVP', label: 'MVP', tournamentName: 'Copa FF', awardedAt: '2026-09-01T12:00:00.000Z' },
    { id: 'a3', type: 'TEN_TOURNAMENTS', label: '10 campeonatos disputados', tournamentName: null, awardedAt: '2026-08-01T12:00:00.000Z' },
  ],
  history: [
    { tournamentId: 't1', tournamentName: 'Liga CR', tournamentSlug: 'liga-cr', gameIcon: '👑', placement: null, finishedAt: null, teamName: null },
    { tournamentId: 't2', tournamentName: 'Open 8 Ball Pool', tournamentSlug: 'open-8-ball-pool', gameIcon: '🎱', placement: 1, finishedAt: '2026-10-23T12:00:00.000Z', teamName: null },
    { tournamentId: 't3', tournamentName: 'Copa FF', tournamentSlug: 'copa-ff', gameIcon: '🔥', placement: 7, finishedAt: '2026-09-01T12:00:00.000Z', teamName: 'Squad Alfa' },
  ],
};

beforeEach(() => {
  state.stats = { isPending: false, isError: false, data: FULL, error: null, refetch: () => undefined };
  state.asked = [];
});

describe('textos do histórico', () => {
  it('colocação', () => {
    expect(placementLabel({ placement: 1, finishedAt: '2026-10-23T12:00:00.000Z' })).toBe('1º lugar');
    expect(placementLabel({ placement: null, finishedAt: '2026-10-23T12:00:00.000Z' })).toBe('Sem colocação');
    expect(placementLabel({ placement: null, finishedAt: null })).toBe('Em andamento');
  });
  it('aproveitamento', () => {
    expect(winRate(5, 6)).toBe('83%');
    expect(winRate(0, 0)).toBe('—');
  });
});

describe('CompetitiveHistory', () => {
  it('cartões por jogo com números em fonte tabular; BR mostra kills, duelo mostra placar', () => {
    render(<CompetitiveHistory nickname="Bianca" />);
    expect(state.asked).toEqual(['Bianca']);
    expect(screen.getByRole('heading', { level: 2, name: 'Histórico competitivo' })).toBeInTheDocument();

    const pool = within(screen.getByRole('article', { name: 'Estatísticas em 8 Ball Pool' }));
    const value = (scope: ReturnType<typeof within>, label: string) => scope.getByText(label).nextElementSibling;
    expect(value(pool, 'Campeonatos')).toHaveTextContent('2');
    expect(value(pool, 'Títulos')).toHaveTextContent('1');
    expect(value(pool, 'Partidas')).toHaveTextContent('6');
    expect(value(pool, 'Vitórias')).toHaveTextContent('5');
    expect(value(pool, 'Aproveitamento')).toHaveTextContent('83%');
    expect(value(pool, 'Placar somado')).toHaveTextContent('11');
    expect(value(pool, 'Títulos')).toHaveClass('tabular');
    expect(pool.queryByText('Kills')).not.toBeInTheDocument();

    const ff = within(screen.getByRole('article', { name: 'Estatísticas em Free Fire' }));
    expect(value(ff, 'Kills')).toHaveTextContent('37');
    expect(ff.queryByText('Placar somado')).not.toBeInTheDocument();
  });

  it('conquistas com ícone + texto e a lista de campeonatos com a colocação', () => {
    render(<CompetitiveHistory nickname="Bianca" />);
    const achievements = within(screen.getByRole('list', { name: 'Conquistas' })).getAllByRole('listitem');
    expect(achievements.map((a) => a.textContent)).toEqual([expect.stringContaining('CampeãoOpen 8 Ball Pool'), expect.stringContaining('MVPCopa FF'), expect.stringContaining('10 campeonatos disputados')]);
    expect(achievements.every((a) => a.querySelector('svg') !== null)).toBe(true);

    const rows = within(screen.getByRole('list', { name: 'Campeonatos disputados' })).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Liga CR');
    expect(rows[0]).toHaveTextContent('Em andamento');
    expect(rows[1]).toHaveTextContent('1º lugar');
    expect(within(rows[1] as HTMLElement).getByRole('link', { name: 'Open 8 Ball Pool' })).toHaveAttribute('href', '/c/open-8-ball-pool');
    expect(rows[2]).toHaveTextContent('Squad Alfa');
    expect(rows[2]).toHaveTextContent('7º lugar');
  });

  it('estado vazio com ação sugerida (texto muda no próprio perfil)', () => {
    state.stats.data = EMPTY;
    const { rerender } = render(<CompetitiveHistory nickname="Lucas" />);
    expect(screen.getByRole('heading', { name: 'Ainda sem campeonatos disputados' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver campeonatos abertos' })).toHaveAttribute('href', '/campeonatos?status=open');
    rerender(<CompetitiveHistory nickname="Lucas" isMine />);
    expect(screen.getByRole('heading', { name: 'Você ainda não disputou campeonatos' })).toBeInTheDocument();
  });

  it('carregando e erro', () => {
    state.stats = { ...state.stats, isPending: true, data: undefined };
    const { rerender } = render(<CompetitiveHistory nickname="Bianca" />);
    expect(screen.getByRole('status', { name: 'Carregando histórico competitivo' })).toBeInTheDocument();
    state.stats = { ...state.stats, isPending: false, isError: true, error: new TypeError('offline') };
    rerender(<CompetitiveHistory nickname="Bianca" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar o histórico competitivo');
  });
});
