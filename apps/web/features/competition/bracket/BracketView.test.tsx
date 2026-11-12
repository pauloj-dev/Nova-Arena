import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { bracketFixture, regId } from '../test/fixtures';
import { BracketView } from './BracketView';
import { matchAriaLabel, matchState } from './matchText';

describe('matchAriaLabel', () => {
  it('lê a rodada, os dois lados, o horário e o resultado', () => {
    const bracket = bracketFixture(8, 'SINGLE_ELIM', { playedRounds: 1 });
    const played = bracket.matches.find((m) => m.round === 1 && m.position === 1)!;
    const label = matchAriaLabel(played, { index: 1, timeZone: 'America/Sao_Paulo' });
    expect(label).toBe('Quartas 1: Squad Alfa contra Squad Hotel, 20h. Concluída: Squad Alfa venceu por 2 x 1.');
    const next = bracket.matches.find((m) => m.round === 3)!;
    expect(matchAriaLabel(next, { timeZone: 'America/Sao_Paulo' })).toMatch(/^Final: .+ contra .+, 20h\. Aguardando\.$/);
  });

  it('estado sempre com texto', () => {
    expect(matchState({ status: 'LIVE', waitingPrevious: false }).label).toBe('Ao vivo');
    expect(matchState({ status: 'SCHEDULED', waitingPrevious: true }).label).toBe('Aguardando');
    expect(matchState({ status: 'WALKOVER', waitingPrevious: false }).label).toBe('W.O.');
  });
});

describe('BracketView', () => {
  it('sem chave: estado vazio', () => {
    render(<BracketView bracket={{ format: 'SINGLE_ELIM', state: 'NONE', matches: [] }} />);
    expect(screen.getByText('A chave ainda não foi gerada')).toBeInTheDocument();
  });

  it.each([8, 16, 32])('SVG com %i participantes: uma partida focável por confronto', (n) => {
    const bracket = bracketFixture(n);
    render(<BracketView bracket={bracket} layout="canvas" label="Chave do mata-mata" />);
    const svg = screen.getByRole('group', { name: 'Chave do mata-mata' });
    expect(within(svg).getAllByRole('button')).toHaveLength(n - 1);
    // Roving tabindex: um só ponto de parada do Tab dentro da chave.
    expect(svg.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  });

  it('navega só com o teclado: Tab entra, setas andam e Enter abre os detalhes', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const bracket = bracketFixture(8, 'SINGLE_ELIM', { playedRounds: 1 });
    render(<BracketView bracket={bracket} layout="canvas" onSelectMatch={onSelect} />);
    // Passa pelos botões de zoom até entrar na chave (um único ponto de parada).
    for (let i = 0; i < 6 && !document.activeElement?.hasAttribute('data-match-id'); i++) await user.tab();
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Quartas 1:/);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Quartas 2:/);
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Semifinal 1:/);
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ roundLabel: 'Semifinal' }));
    expect(screen.getByRole('heading', { name: 'Partida selecionada' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('heading', { name: 'Partida selecionada' })).not.toBeInTheDocument();
  });

  it('destaca o caminho do participante e começa o Tab na próxima partida dele', () => {
    const bracket = bracketFixture(8, 'SINGLE_ELIM', { playedRounds: 1 });
    const { container } = render(<BracketView bracket={bracket} layout="canvas" highlightRegistrationId={regId(0)} />);
    // Alfa (seed 1) venceu as quartas: a ligação quartas → semifinal fica destacada.
    expect(container.querySelectorAll('[data-highlighted="true"]')).toHaveLength(1);
    expect(container.querySelector('[tabindex="0"]')?.getAttribute('aria-label')).toMatch(/^Semifinal 1: Squad Alfa contra Squad Delta/);
  });

  it('celular: uma aba por rodada, abrindo na rodada em aberto', async () => {
    const user = userEvent.setup();
    const bracket = bracketFixture(16, 'SINGLE_ELIM', { playedRounds: 1 });
    render(<BracketView bracket={bracket} layout="list" label="Chave" />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Oitavas de final', 'Quartas de final', 'Semifinal', 'Final']);
    expect(screen.getByRole('tab', { name: 'Quartas de final' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('tab', { name: 'Oitavas de final' }));
    const list = screen.getByRole('list', { name: 'Oitavas de final' });
    expect(within(list).getAllByRole('listitem', { hidden: false }).filter((li) => li.parentElement === list)).toHaveLength(8);
  });

  it('celular, eliminação dupla: abas da chave superior, inferior e Grande Final', () => {
    render(<BracketView bracket={bracketFixture(8, 'DOUBLE_ELIM')} layout="list" />);
    const labels = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(labels[0]).toBe('Superior: Rodada 1');
    expect(labels).toContain('Inferior: Rodada 1');
    expect(labels).toContain('Grande Final');
  });
});
