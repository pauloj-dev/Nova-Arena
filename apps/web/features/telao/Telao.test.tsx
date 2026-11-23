import { act, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildStage, standingRow } from '@/features/brackets/test/fixtures';
import { useReducedMotion, useRotation, useTelaoEnvironment } from './hooks';
import { bracketPages } from './telao';
import { TelaoBracket } from './TelaoBracket';
import { TelaoStandings } from './TelaoStandings';

function mockMatchMedia(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches: reduce && query.includes('reduce'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useRotation', () => {
  beforeEach(() => vi.useFakeTimers());

  it('gira entre as páginas no intervalo e volta ao início', () => {
    const { result } = renderHook(() => useRotation(3, 1000));
    expect(result.current.index).toBe(0);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.index).toBe(1);
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.index).toBe(0);
  });

  it('não gira com uma página só', () => {
    const { result } = renderHook(() => useRotation(1, 1000));
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.index).toBe(0);
  });

  it('pausa, retoma e navega à mão', () => {
    const { result } = renderHook(() => useRotation(3, 1000));
    act(() => result.current.togglePause());
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.index).toBe(0);
    expect(result.current.paused).toBe(true);
    act(() => result.current.previous());
    expect(result.current.index).toBe(2);
    act(() => result.current.next());
    expect(result.current.index).toBe(0);
  });

  it('quando o número de páginas diminui, não aponta para página que não existe', () => {
    const { result, rerender } = renderHook(({ count }) => useRotation(count, 1000), { initialProps: { count: 3 } });
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.index).toBe(2);
    rerender({ count: 2 });
    expect(result.current.index).toBe(1);
  });
});

describe('useTelaoEnvironment', () => {
  it('fundo transparente no html e no body enquanto o telão está aberto, e devolve ao sair', () => {
    document.documentElement.dataset.theme = 'light';
    const { unmount } = renderHook(() => useTelaoEnvironment(true, 'escuro'));
    expect(document.body.style.backgroundColor).toBe('transparent');
    expect(document.documentElement.style.backgroundColor).toBe('transparent');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.telao).toBe('transparente');
    unmount();
    expect(document.body.style.backgroundColor).toBe('');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.telao).toBeUndefined();
  });

  it('sem `fundo=transparente`, mantém o fundo do tema', () => {
    renderHook(() => useTelaoEnvironment(false, 'claro'));
    expect(document.body.style.backgroundColor).toBe('');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

describe('useReducedMotion', () => {
  it('segue a preferência do sistema', () => {
    mockMatchMedia(true);
    expect(renderHook(() => useReducedMotion()).result.current).toBe(true);
    mockMatchMedia(false);
    expect(renderHook(() => useReducedMotion()).result.current).toBe(false);
  });
});

describe('TelaoStandings', () => {
  const rows = [
    standingRow(1, { registrationId: 'a', name: 'Squad Alfa', points: 9, qualifying: true }),
    standingRow(2, { registrationId: 'b', name: 'Squad Bravo', points: 6 }),
  ];

  it('mostra posição, nome, pontos e a zona de classificação com ícone e texto', () => {
    render(<TelaoStandings page={{ key: 'g', label: 'Grupo A', rows }} matchType="DUEL" transparent={false} />);
    const table = screen.getByRole('table', { name: 'Classificação · Grupo A' });
    const lines = within(table).getAllByTestId('telao-linha');
    expect(lines.map((l) => l.getAttribute('data-registration'))).toEqual(['a', 'b']);
    expect(within(lines[0] as HTMLElement).getAllByText('Classifica').length).toBeGreaterThan(0);
    expect(screen.getByText('Zona de classificação para a próxima fase')).toBeInTheDocument();
  });

  it('não anima a troca de posição quando a pessoa pede menos movimento', () => {
    mockMatchMedia(true);
    const animate = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'animate', { value: animate, configurable: true });
    const { rerender } = render(<TelaoStandings page={{ key: 'g', label: 'Grupo A', rows }} matchType="DUEL" transparent={false} />);
    rerender(<TelaoStandings page={{ key: 'g', label: 'Grupo A', rows: [{ ...rows[1]!, position: 1 }, { ...rows[0]!, position: 2 }] }} matchType="DUEL" transparent={false} />);
    expect(animate).not.toHaveBeenCalled();
    Reflect.deleteProperty(HTMLElement.prototype, 'animate');
  });

  it('Battle Royale mostra Booyahs e Kills', () => {
    render(<TelaoStandings page={{ key: 'g', label: 'Sala 1', rows }} matchType="BATTLE_ROYALE" transparent />);
    expect(screen.getByRole('columnheader', { name: 'Booyahs' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Kills' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Squad' })).toBeInTheDocument();
  });
});

describe('TelaoBracket', () => {
  it('mostra as rodadas lado a lado e o vencedor com ícone e texto', () => {
    const stage = buildStage('SINGLE_ELIM', 4);
    stage.play('w-r1-m1', 0);
    const [page] = bracketPages(stage.bracket());
    render(<TelaoBracket page={page!} transparent={false} />);
    expect(screen.getByRole('region', { name: 'Semifinal' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Final' })).toBeInTheDocument();
    expect(screen.getAllByTestId('telao-partida')).toHaveLength(3);
    expect(screen.getByText('vencedor')).toBeInTheDocument();
  });
});
