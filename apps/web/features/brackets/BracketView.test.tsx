import type { Match } from '@nova/schemas';
import { ToastProvider } from '@nova/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { matchAriaLabel } from '@/features/matches/matchText';
import { fitView, MAX_SCALE, MIN_SCALE, revealNode, zoomView } from './BracketCanvas';
import { BracketView } from './BracketView';
import { RoundsView } from './RoundsView';
import { buildStage, matchId } from './test/fixtures';

vi.mock('@/features/disputes/MatchResultActions', () => ({ MatchResultActions: () => null }));
vi.mock('@/features/reports/ReportButton', () => ({ ReportButton: () => null }));

function wrap(ui: ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
}

function setViewport(wide: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: wide && query.includes('min-width'), media: query, addEventListener: () => {}, removeEventListener: () => {} }));
}

/** O `<g>` do confronto na chave em SVG (tipado como HTMLElement só para as consultas da Testing Library). */
const nodeOf = (nodeId: string) => document.querySelector(`[data-match-id="${matchId(nodeId)}"]`) as unknown as HTMLElement;

afterEach(() => vi.unstubAllGlobals());

describe('BracketView — chave em SVG (desktop e tablet)', () => {
  it('desenha um confronto focável por partida, com aria-label completo, rótulos de rodada e conectores', () => {
    const stage = buildStage('SINGLE_ELIM', 8, { bestOf: 3, thirdPlace: true });
    stage.play('w-r1-m1', 0);
    const bracket = stage.bracket((node) => (node.id === 'w-r1-m2' ? { scheduledAt: '2026-11-14T23:00:00.000Z' } : {}));
    wrap(<BracketView bracket={bracket} mode="canvas" onMatchSelect={() => {}} />);

    expect(screen.getByTestId('bracket-view')).toHaveAttribute('data-mode', 'canvas');
    expect(screen.getByRole('group', { name: 'Chave com 8 confrontos' })).toBeInTheDocument();
    const matches = screen.getAllByTestId('bracket-match');
    expect(matches).toHaveLength(8);
    // Cada confronto é um botão com o nome acessível completo.
    for (const match of bracket.matches) expect(screen.getByRole('button', { name: matchAriaLabel(match) })).toBeInTheDocument();
    expect(nodeOf('w-r1-m1')).toHaveAttribute('aria-label', 'Quartas de final: Squad 1 contra Squad 8, horário a definir, concluída, Squad 1 venceu por 2 a 0');
    expect(nodeOf('w-r2-m1').getAttribute('aria-label')).toMatch(/^Semifinal: Squad 1 contra a definir \(Vencedor: Quartas de final 2\), horário a definir, agendada$/);
    expect(nodeOf('w-r1-m2').getAttribute('aria-label')).toMatch(/^Quartas de final: Squad 4 contra Squad 5, 1[45]\/11 às \d+h(\d\d)?, .+, agendada$/);

    // Rótulo de cada rodada e da disputa de 3º lugar.
    const svg = screen.getByRole('group', { name: 'Chave com 8 confrontos' });
    for (const label of ['Quartas de final', 'Semifinal', 'Final', 'Disputa de 3º lugar']) expect(within(svg).getAllByText(label, { selector: 'text' }).length).toBeGreaterThan(0);
    expect(svg.querySelectorAll(':scope > g > path')).toHaveLength(6); // 4 quartas → 2 semis → final (os ícones têm os seus próprios paths)

    // Vaga vazia mostra de onde vem o ocupante; vencedor em negrito.
    expect(within(nodeOf('w-r2-m1')).getByText('Vencedor: Quartas de final 2', { selector: 'text' })).toBeInTheDocument();
    expect(within(nodeOf('w-r1-m1')).getByText('Squad 1', { selector: 'text' })).toHaveClass('font-bold');
    expect(within(nodeOf('w-r1-m1')).getByText('Concluída')).toBeInTheDocument();
  });

  it('só um confronto entra na ordem do Tab; as setas andam entre eles e Enter abre o detalhe', () => {
    const onMatchSelect = vi.fn();
    const bracket = buildStage('SINGLE_ELIM', 8).bracket();
    wrap(<BracketView bracket={bracket} mode="canvas" onMatchSelect={onMatchSelect} />);

    const tabbable = () => screen.getAllByTestId('bracket-match').filter((g) => g.getAttribute('tabindex') === '0');
    expect(tabbable()).toHaveLength(1);
    expect(tabbable()[0]).toBe(nodeOf('w-r1-m1'));

    act(() => nodeOf('w-r1-m1').focus());
    expect(screen.getByTestId('bracket-focus-ring')).toBeInTheDocument(); // foco visível
    fireEvent.keyDown(nodeOf('w-r1-m1'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(nodeOf('w-r1-m2'));
    fireEvent.keyDown(nodeOf('w-r1-m2'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(nodeOf('w-r2-m1'));
    fireEvent.keyDown(nodeOf('w-r2-m1'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(nodeOf('w-r3-m1'));
    fireEvent.keyDown(nodeOf('w-r3-m1'), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(nodeOf('w-r2-m1'));
    fireEvent.keyDown(nodeOf('w-r2-m1'), { key: 'ArrowUp' }); // já é o primeiro da coluna: fica onde está
    expect(document.activeElement).toBe(nodeOf('w-r2-m1'));
    fireEvent.keyDown(nodeOf('w-r2-m1'), { key: 'End' });
    expect(document.activeElement).toBe(nodeOf('w-r3-m1'));
    fireEvent.keyDown(nodeOf('w-r3-m1'), { key: 'Home' });
    expect(document.activeElement).toBe(nodeOf('w-r1-m1'));
    // O Tab volta para o último confronto visitado (roving tabindex).
    expect(tabbable()).toEqual([nodeOf('w-r1-m1')]);

    fireEvent.keyDown(nodeOf('w-r1-m1'), { key: 'Enter' });
    expect(onMatchSelect).toHaveBeenLastCalledWith(bracket.matches.find((m) => m.nodeId === 'w-r1-m1'));
    fireEvent.keyDown(nodeOf('w-r1-m1'), { key: ' ' });
    fireEvent.click(nodeOf('w-r1-m3'));
    expect(onMatchSelect).toHaveBeenCalledTimes(3);
    expect(onMatchSelect).toHaveBeenLastCalledWith(bracket.matches.find((m) => m.nodeId === 'w-r1-m3'));
  });

  it('destaca o caminho de quem está vendo (borda, ★ e texto no aria-label) e projeta o caminho até a final', () => {
    const stage = buildStage('SINGLE_ELIM', 8);
    stage.play('w-r1-m1', 0);
    wrap(<BracketView bracket={stage.bracket()} mode="canvas" highlightRegistrationId="r1" onMatchSelect={() => {}} />);
    const highlighted = screen.getAllByTestId('bracket-match').filter((g) => g.getAttribute('data-highlight') === 'true');
    expect(highlighted).toEqual([nodeOf('w-r1-m1'), nodeOf('w-r2-m1')]);
    expect(nodeOf('w-r2-m1').getAttribute('aria-label')).toMatch(/, seu confronto$/);
    expect(within(nodeOf('w-r2-m1')).getByText(/★ Squad 1/)).toBeInTheDocument();
    expect(document.querySelectorAll('path[data-path="walked"]')).toHaveLength(1);
    expect(document.querySelectorAll('path[data-path="projected"]')).toHaveLength(1);
    // O Tab começa no confronto pendente dela.
    expect(nodeOf('w-r2-m1')).toHaveAttribute('tabindex', '0');
    expect(screen.getByText(/Seu caminho na chave está marcado com ★/)).toBeInTheDocument();
  });

  it('zoom pelos botões: aumentar, diminuir e ajustar', () => {
    wrap(<BracketView bracket={buildStage('SINGLE_ELIM', 16).bracket()} mode="canvas" onMatchSelect={() => {}} />);
    const zoom = screen.getByTestId('bracket-zoom');
    expect(zoom).toHaveTextContent('100%');
    fireEvent.click(screen.getByRole('button', { name: 'Aumentar zoom' }));
    expect(zoom).toHaveTextContent('125%');
    fireEvent.click(screen.getByRole('button', { name: 'Diminuir zoom' }));
    fireEvent.click(screen.getByRole('button', { name: 'Diminuir zoom' }));
    expect(zoom).toHaveTextContent('80%');
    fireEvent.click(screen.getByRole('button', { name: 'Ajustar a chave à tela' }));
    expect(Number.parseInt(zoom.textContent ?? '', 10)).toBeLessThanOrEqual(100);
  });

  it('Ctrl + roda do mouse dá zoom; sem Ctrl a página rola normalmente', () => {
    wrap(<BracketView bracket={buildStage('SINGLE_ELIM', 8).bracket()} mode="canvas" onMatchSelect={() => {}} />);
    const area = screen.getByRole('group', { name: /^Chave com/ }).parentElement as HTMLElement;
    const zoom = screen.getByTestId('bracket-zoom');
    fireEvent.wheel(area, { deltaY: -200 });
    expect(zoom).toHaveTextContent('100%');
    fireEvent.wheel(area, { deltaY: -200, ctrlKey: true });
    expect(Number.parseInt(zoom.textContent ?? '', 10)).toBeGreaterThan(100);
  });

  it('arrastar move a chave e não abre a partida que estava embaixo do cursor', () => {
    const onMatchSelect = vi.fn();
    wrap(<BracketView bracket={buildStage('SINGLE_ELIM', 8).bracket()} mode="canvas" onMatchSelect={onMatchSelect} />);
    const svg = screen.getByRole('group', { name: /^Chave com/ });
    const area = svg.parentElement as HTMLElement;
    const transform = () => svg.querySelector('g')?.getAttribute('transform');
    expect(transform()).toBe('translate(0 0) scale(1)');
    fireEvent.pointerDown(area, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(area, { pointerId: 1, clientX: 60, clientY: 130 });
    expect(transform()).toBe('translate(-40 30) scale(1)');
    fireEvent.pointerUp(area, { pointerId: 1 });
    fireEvent.click(nodeOf('w-r1-m1'));
    expect(onMatchSelect).not.toHaveBeenCalled();
  });

  it('contas de zoom e enquadramento', () => {
    expect(zoomView({ scale: 1, x: 0, y: 0 }, 2, 100, 50)).toEqual({ scale: 2, x: -100, y: -50 }); // o ponto sob o cursor fica parado
    expect(zoomView({ scale: 1, x: 0, y: 0 }, 100, 0, 0).scale).toBe(MAX_SCALE);
    expect(zoomView({ scale: 1, x: 0, y: 0 }, 0.001, 0, 0).scale).toBe(MIN_SCALE);
    expect(fitView({ width: 2000, height: 500 }, 1000, 600)).toEqual({ scale: 0.5, x: 0, y: 175 });
    expect(fitView({ width: 400, height: 300 }, 1000, 600).scale).toBe(1); // não amplia além de 100%
    const view = { scale: 1, x: 0, y: 0 };
    expect(revealNode(view, { x: 20, y: 20, width: 100, height: 50 }, 500, 400)).toBe(view); // já visível: não mexe
    expect(revealNode(view, { x: 600, y: 20, width: 100, height: 50 }, 500, 400)).toEqual({ scale: 1, x: -216, y: 0 });
  });

  it('sem `onMatchSelect`, Enter abre o detalhe da partida com o MatchCard completo', async () => {
    const stage = buildStage('SINGLE_ELIM', 4);
    stage.play('w-r1-m1', 0);
    wrap(<BracketView bracket={stage.bracket()} mode="canvas" />);
    act(() => nodeOf('w-r1-m1').focus());
    fireEvent.keyDown(nodeOf('w-r1-m1'), { key: 'Enter' });
    const dialog = await screen.findByRole('dialog', { name: 'Detalhes da partida' });
    expect(within(dialog).getByTestId('match-card')).toHaveAttribute('data-match-id', matchId('w-r1-m1'));
    expect(within(dialog).getByRole('list', { name: 'Lados do confronto' })).toHaveTextContent('Squad 1');
    expect(within(dialog).getByText('Squad 1 venceu por 1 a 0.')).toBeInTheDocument();

    // Fechar devolve o foco ao confronto (um `<g>` do SVG, que o Modal sozinho não sabe refocar).
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(nodeOf('w-r1-m1')));
  });

  it('eliminação dupla: títulos das duas chaves, Grande Final e reset "se necessário"', () => {
    const bracket = buildStage('DOUBLE_ELIM', 8, { grandFinalReset: true }).bracket();
    wrap(<BracketView bracket={bracket} mode="canvas" onMatchSelect={() => {}} />);
    expect(screen.getAllByTestId('bracket-match')).toHaveLength(bracket.matches.length);
    const svg = screen.getByRole('group', { name: /^Chave com/ });
    expect(within(svg).getByText('Chave de vencedores')).toBeInTheDocument();
    expect(within(svg).getByText('Chave de perdedores')).toBeInTheDocument();
    expect(within(svg).getAllByText('Grande Final', { selector: 'text' }).length).toBeGreaterThan(0);
    expect(within(nodeOf('gf-2')).getByText(/Se necessário/)).toBeInTheDocument();
    expect(nodeOf('gf-2').getAttribute('aria-label')).toContain('só acontece se for necessário');
  });

  it('pontos de extensão da organização: vagas viram botões, com seleção e atributos extras', () => {
    const onSlotClick = vi.fn();
    const onMatchSelect = vi.fn();
    const bracket = buildStage('SINGLE_ELIM', 8).bracket();
    wrap(
      <BracketView
        bracket={bracket}
        mode="canvas"
        onMatchSelect={onMatchSelect}
        onSlotClick={onSlotClick}
        selectedRegistrationId="r8"
        getSlotProps={(p) => ({ 'data-drag-id': p.registrationId })}
      />,
    );
    const slot = screen.getByRole('button', { name: 'Squad 1, cabeça de chave 1' });
    const selected = screen.getByRole('button', { name: 'Squad 8, cabeça de chave 8, selecionado para troca' });
    expect(selected).toHaveAttribute('aria-pressed', 'true');
    expect(slot).toHaveAttribute('aria-pressed', 'false');
    expect(slot).toHaveAttribute('data-drag-id', 'r1');
    // A vaga não fica dentro do botão do confronto (nada de botão dentro de botão).
    expect(nodeOf('w-r1-m1').contains(slot)).toBe(false);

    fireEvent.click(slot);
    expect(onSlotClick).toHaveBeenLastCalledWith('r1', bracket.matches.find((m) => m.nodeId === 'w-r1-m1'));
    fireEvent.keyDown(selected, { key: 'Enter' });
    expect(onSlotClick).toHaveBeenLastCalledWith('r8', bracket.matches.find((m) => m.nodeId === 'w-r1-m1'));
    expect(onMatchSelect).not.toHaveBeenCalled(); // clicar na vaga não abre o detalhe
    fireEvent.click(nodeOf('w-r1-m1'));
    expect(onMatchSelect).toHaveBeenCalledTimes(1);
  });

  it('chave ainda não gerada mostra estado vazio', () => {
    wrap(<BracketView bracket={{ ...buildStage('SINGLE_ELIM', 8).bracket(), state: 'NONE', matches: [] }} mode="canvas" />);
    expect(screen.getByText('A chave ainda não foi gerada')).toBeInTheDocument();
  });
});

describe('BracketView — lista por rodada com abas (celular)', () => {
  it('abaixo de 768 px não há SVG: uma aba por rodada, com cada confronto como botão rotulado', async () => {
    setViewport(false);
    const user = userEvent.setup();
    const stage = buildStage('SINGLE_ELIM', 8, { thirdPlace: true });
    const bracket = stage.bracket();
    wrap(<BracketView bracket={bracket} highlightRegistrationId="r4" />);

    expect(screen.getByTestId('bracket-view')).toHaveAttribute('data-mode', 'list');
    expect(document.querySelector('svg[role="group"]')).toBeNull();
    const tabs = screen.getByRole('tablist', { name: 'Rodadas da chave' });
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Quartas de final', 'Semifinal', 'Final']);
    expect(within(tabs).getByRole('tab', { name: 'Quartas de final' })).toHaveAttribute('aria-selected', 'true');

    const list = screen.getByRole('list', { name: 'Confrontos: Quartas de final' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(4);
    for (const match of bracket.matches.filter((m) => m.round === 1)) expect(screen.getByRole('button', { name: matchAriaLabel(match, { highlightRegistrationId: 'r4' }) })).toBeInTheDocument();
    // O confronto de quem está vendo vem marcado com texto, não só com cor.
    const mine = screen.getAllByTestId('bracket-match').filter((el) => el.getAttribute('data-highlight') === 'true');
    expect(mine).toHaveLength(1);
    expect(within(mine[0] as HTMLElement).getByText('Seu confronto')).toBeInTheDocument();

    await user.click(within(tabs).getByRole('tab', { name: 'Final' }));
    const final = screen.getByRole('list', { name: 'Confrontos: Final' });
    expect(within(final).getAllByRole('listitem')).toHaveLength(2);
    expect(within(final).getByText('Disputa de 3º lugar')).toBeInTheDocument();
    expect(within(final).getByText('Perdedor: Semifinal 1')).toBeInTheDocument();
  });

  it('a partir de 768 px troca sozinho para o SVG', () => {
    setViewport(true);
    wrap(<BracketView bracket={buildStage('SINGLE_ELIM', 4).bracket()} />);
    expect(screen.getByTestId('bracket-view')).toHaveAttribute('data-mode', 'canvas');
  });

  it('setas ↑ ↓ andam entre os confrontos da lista e o clique abre o detalhe', async () => {
    const onMatchSelect = vi.fn();
    const bracket = buildStage('SINGLE_ELIM', 8).bracket();
    wrap(<BracketView bracket={bracket} mode="list" onMatchSelect={onMatchSelect} />);
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-bracket-match]')];
    expect(buttons).toHaveLength(4);
    (buttons[0] as HTMLButtonElement).focus();
    fireEvent.keyDown(buttons[0] as HTMLButtonElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(buttons[1]);
    fireEvent.keyDown(buttons[1] as HTMLButtonElement, { key: 'End' });
    expect(document.activeElement).toBe(buttons[3]);
    fireEvent.keyDown(buttons[3] as HTMLButtonElement, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(buttons[2]);
    fireEvent.click(buttons[2] as HTMLButtonElement);
    expect(onMatchSelect).toHaveBeenCalledWith(bracket.matches.find((m) => m.nodeId === 'w-r1-m3'));
  });

  it('eliminação dupla separa "Vencedores", "Perdedores" e "Final"', async () => {
    const user = userEvent.setup();
    wrap(<BracketView bracket={buildStage('DOUBLE_ELIM', 8).bracket()} mode="list" onMatchSelect={() => {}} />);
    const sides = screen.getByRole('tablist', { name: 'Lados da chave' });
    expect(within(sides).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Vencedores', 'Perdedores', 'Final']);
    expect(screen.getByRole('tablist', { name: 'Rodadas: Vencedores' })).toBeInTheDocument();
    await user.click(within(sides).getByRole('tab', { name: 'Perdedores' }));
    expect(within(screen.getByRole('tablist', { name: 'Rodadas: Perdedores' })).getAllByRole('tab').length).toBeGreaterThan(1);
    await user.click(within(sides).getByRole('tab', { name: 'Final' }));
    const finals = screen.getByRole('list', { name: 'Confrontos: Grande Final' });
    expect(within(finals).getByText('Grande Final (reset)')).toBeInTheDocument();
  });

  it('na lista, `onSlotClick` e `renderSlotAction` ficam em cada vaga ocupada', () => {
    const onSlotClick = vi.fn();
    const bracket = buildStage('SINGLE_ELIM', 4).bracket();
    wrap(<BracketView bracket={bracket} mode="list" onMatchSelect={() => {}} onSlotClick={onSlotClick} selectedRegistrationId="r1" renderSlotAction={(p) => <span data-testid="slot-action">{p.seed}</span>} />);
    expect(screen.getAllByTestId('slot-action')).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Squad 1, cabeça de chave 1, selecionado para troca' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Squad 4, cabeça de chave 4' }));
    expect(onSlotClick).toHaveBeenCalledWith('r4', bracket.matches[0]);
  });
});

describe('RoundsView — formatos sem chave em árvore', () => {
  it('BracketView entrega grupos, pontos corridos, suíço e BR ao RoundsView (sem SVG)', () => {
    wrap(<BracketView bracket={buildStage('SWISS', 8, { rounds: 3 }).bracket()} mode="canvas" onMatchSelect={() => {}} />);
    expect(screen.getByTestId('rounds-view')).toBeInTheDocument();
    expect(screen.queryByTestId('bracket-canvas')).not.toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Partidas: Rodada 1' })).getAllByRole('listitem')).toHaveLength(4);
  });

  it('grupos em quedas BR: aba por queda, seção por grupo, cada queda com nome acessível', async () => {
    const user = userEvent.setup();
    const onMatchSelect = vi.fn();
    const stage = buildStage('GROUPS', 24, { groupCount: 2, groupMode: 'BATTLE_ROYALE', drops: 3 });
    const first = stage.matches()[0] as Match;
    stage.playLobby(first.nodeId);
    const bracket = stage.bracket();
    const mine = first.participants[1]?.registrationId as string;
    wrap(<RoundsView bracket={bracket} highlightRegistrationId={mine} onMatchSelect={onMatchSelect} />);

    const tabs = screen.getByRole('tablist', { name: 'Rodadas da fase de grupos' });
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Queda 1', 'Queda 2', 'Queda 3']);
    // Abre na primeira queda ainda por jogar de quem está vendo.
    expect(within(tabs).getByRole('tab', { name: 'Queda 2' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Grupo A' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Grupo B' })).toBeInTheDocument();

    await user.click(within(tabs).getByRole('tab', { name: 'Queda 1' }));
    const played = screen.getByRole('button', { name: /^Grupo A, Queda 1: 12 equipes, horário a definir, concluída, .+ levou o Booyah, seu confronto$/ });
    const card = played.closest('[data-testid="bracket-match"]') as HTMLElement;
    expect(within(card).getByText('Sua queda')).toBeInTheDocument();
    expect(within(card).getByText(/^Booyah: /)).toBeInTheDocument();
    expect(within(card).getByText('Seu squad: 2º · 11 kills · 11 pts')).toBeInTheDocument();
    await user.click(played);
    expect(onMatchSelect).toHaveBeenCalledWith(bracket.matches[0]);
  });

  it('pontos corridos: uma aba por rodada; fase sem partidas mostra estado vazio', () => {
    const { unmount } = wrap(<RoundsView bracket={buildStage('ROUND_ROBIN', 4).bracket()} onMatchSelect={() => {}} />);
    expect(within(screen.getByRole('tablist', { name: 'Rodadas' })).getAllByRole('tab')).toHaveLength(3);
    unmount();
    wrap(<RoundsView bracket={{ format: 'ROUND_ROBIN', matches: [], state: 'NONE' }} />);
    expect(screen.getByText('Nenhuma partida nesta fase ainda')).toBeInTheDocument();
  });
});
