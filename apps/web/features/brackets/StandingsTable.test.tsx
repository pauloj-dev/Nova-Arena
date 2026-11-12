import type { Standings, StandingRow } from '@nova/schemas';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BRStandingsTable } from './BRStandingsTable';
import { GroupTable } from './GroupTable';
import { StageStandings } from './StageStandings';
import { formatDiff, formatPoints, summarizeChanges } from './standingsText';
import { StandingsTable } from './StandingsTable';
import { standingRow } from './test/fixtures';

// O Popover do Radix mede o gatilho; o jsdom não tem ResizeObserver.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => vi.stubGlobal('ResizeObserver', ResizeObserverStub));
afterEach(() => vi.unstubAllGlobals());

/** Linhas de corpo que são de participante (ignora a linha expansível). */
function dataRows(table: HTMLElement): HTMLElement[] {
  return within(table).getAllByRole('row').filter((r) => r.hasAttribute('data-registration-id'));
}
const names = (table: HTMLElement) => dataRows(table).map((r) => within(r).getByRole('rowheader').textContent);

const drops = (list: [number | null, number, number][]): StandingRow['perDrop'] => list.map(([placement, kills, points], i) => ({ dropIndex: i + 1, placement, kills, points }));

describe('StandingsTable — duelos', () => {
  const rows = [
    standingRow(1, { name: 'Squad Alfa', qualifying: true, played: 3, wins: 3, draws: 0, losses: 0, scoreDiff: 5, points: 9 }),
    standingRow(2, { name: 'Squad Bravo', tag: 'BRV', qualifying: true, played: 3, wins: 2, draws: 0, losses: 1, scoreDiff: 2, points: 6, tiebreakNote: 'Empate em pontos com Squad Charlie. Desempate por saldo (+2).' }),
    standingRow(3, { name: 'Squad Charlie', played: 3, wins: 2, draws: 0, losses: 1, scoreDiff: -1, points: 6, tiebreakNote: 'Empate em pontos com Squad Bravo. Desempate por saldo (-1).' }),
    standingRow(4, { name: 'Squad Delta', played: 3, wins: 0, draws: 1, losses: 2, scoreDiff: -6, points: 1, status: 'DISQUALIFIED' }),
    standingRow(5, { name: 'Squad Eco', played: 3, wins: 0, draws: 1, losses: 2, scoreDiff: 0, points: 1, status: 'WITHDRAWN' }),
  ];

  it('colunas Pos, Equipe, J, V, E, D, Saldo e Pts, com cabeçalho fixo e números em fonte tabular', () => {
    render(<StandingsTable rows={rows} caption="Classificação da fase" />);
    const table = screen.getByRole('table', { name: 'Classificação da fase' });
    const headers = within(table).getAllByRole('columnheader');
    expect(headers.map((h) => h.textContent)).toEqual(['Pos', 'Equipe', 'J', 'V', 'E', 'D', 'Saldo', 'Pts', 'Mais números']);
    for (const h of headers) expect(h).toHaveClass('sticky');
    expect(within(headers[2] as HTMLElement).getByTitle('Jogos')).toBeInTheDocument();
    const cells = within(dataRows(table)[0] as HTMLElement).getAllByRole('cell');
    expect(cells.slice(1, 7).map((c) => c.textContent)).toEqual(['3', '3', '0', '0', '+5', '9']);
    for (const c of cells.slice(1, 7)) expect(c).toHaveClass('tabular');
  });

  it('mostra as linhas na ordem que veio da API, sem reordenar', () => {
    const shuffled = [rows[2], rows[0], rows[4], rows[1], rows[3]] as StandingRow[];
    render(<StandingsTable rows={shuffled} caption="Classificação" />);
    expect(names(screen.getByRole('table'))).toEqual(shuffled.map((r) => expect.stringContaining(r.name)));
  });

  it('zona de classificação: fundo, ícone com texto e legenda (nunca só cor)', () => {
    render(<StandingsTable rows={rows} caption="Classificação" />);
    const table = screen.getByRole('table');
    const [alfa, bravo, charlie] = dataRows(table);
    for (const row of [alfa, bravo]) {
      expect(row).toHaveClass('bg-primary-soft');
      expect(row).toHaveAttribute('data-qualifying', 'true');
      expect(within(row as HTMLElement).getByText('Classifica:')).toBeInTheDocument();
    }
    expect(charlie).not.toHaveClass('bg-primary-soft');
    expect(within(charlie as HTMLElement).queryByText('Classifica:')).not.toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Legenda' })).getByText('Classifica para a próxima fase')).toBeInTheDocument();
  });

  it('sem zona de classificação não há legenda dela', () => {
    render(<StandingsTable rows={rows.map((r) => ({ ...r, qualifying: false, tiebreakNote: null }))} caption="Classificação" />);
    expect(screen.queryByRole('list', { name: 'Legenda' })).not.toBeInTheDocument();
  });

  it('desclassificados e desistentes vêm marcados; a linha de quem está vendo fica destacada com "Você"', () => {
    render(<StandingsTable rows={rows} caption="Classificação" highlightRegistrationId="r3" />);
    const [, , charlie, delta, eco] = dataRows(screen.getByRole('table'));
    expect(within(delta as HTMLElement).getByText('Desclassificado')).toBeInTheDocument();
    expect(within(eco as HTMLElement).getByText('Desistência')).toBeInTheDocument();
    expect(charlie).toHaveAttribute('data-mine', 'true');
    expect(within(charlie as HTMLElement).getByText('Você')).toBeInTheDocument();
    expect(within(charlie as HTMLElement).getByText('Squad Charlie')).toHaveClass('font-bold');
  });

  it('tocar na posição abre a explicação do desempate; posição sem desempate não é botão', async () => {
    const user = userEvent.setup();
    render(<StandingsTable rows={rows} caption="Classificação" />);
    const [alfa, bravo] = dataRows(screen.getByRole('table'));
    expect(within(alfa as HTMLElement).queryByRole('button', { name: /desempate/ })).not.toBeInTheDocument();
    const trigger = within(bravo as HTMLElement).getByRole('button', { name: '2º lugar. Ver como o desempate foi decidido' });
    expect(screen.queryByTestId('tiebreak-popover')).not.toBeInTheDocument();
    await user.click(trigger);
    const popover = await screen.findByTestId('tiebreak-popover');
    expect(popover).toHaveTextContent('Empate em pontos com Squad Charlie. Desempate por saldo (+2).');
    expect(popover).not.toHaveTextContent('Seed do sorteio');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    // Fecha com Esc e devolve o foco ao botão da posição.
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('tiebreak-popover')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    // Também abre pelo teclado.
    await user.keyboard('{Enter}');
    expect(await screen.findByTestId('tiebreak-popover')).toBeInTheDocument();
  });

  it('quando o desempate foi por sorteio, mostra a seed', async () => {
    const user = userEvent.setup();
    const drawn = [standingRow(1, { tiebreakNote: 'Empate em pontos com Squad 2. Desempate por sorteio (seed "liga-cr-2026").' }), standingRow(2, { tiebreakNote: 'Empate em pontos com Squad 1. Desempate por saldo (+1).' })];
    render(<StandingsTable rows={drawn} caption="Classificação" drawSeed="liga-cr-2026" />);
    await user.click(screen.getByRole('button', { name: '1º lugar. Ver como o desempate foi decidido' }));
    expect(await screen.findByTestId('tiebreak-popover')).toHaveTextContent('Seed do sorteio: liga-cr-2026');
    await user.keyboard('{Escape}');
    // Desempate por outro critério não mostra a seed, mesmo que tenha havido sorteio na fase.
    await user.click(screen.getByRole('button', { name: '2º lugar. Ver como o desempate foi decidido' }));
    expect(await screen.findByTestId('tiebreak-popover')).not.toHaveTextContent('Seed do sorteio');
  });

  it('celular: J, V, E, D e Saldo saem da tabela e vão para a linha expansível', async () => {
    const user = userEvent.setup();
    render(<StandingsTable rows={rows} caption="Classificação" />);
    const table = screen.getByRole('table');
    const headers = within(table).getAllByRole('columnheader');
    // Pos, Equipe e Pts ficam sempre; as demais só a partir de 768 px.
    expect(headers.filter((h) => h.classList.contains('hidden')).map((h) => h.textContent)).toEqual(['J', 'V', 'E', 'D', 'Saldo']);
    for (const h of headers.filter((x) => x.classList.contains('hidden'))) expect(h).toHaveClass('md:table-cell');
    expect(table).toHaveClass('table-fixed', 'w-full'); // nunca passa da largura da tela

    const toggle = screen.getByRole('button', { name: 'Ver os números de Squad Bravo' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    const expanded = screen.getByRole('button', { name: 'Esconder os números de Squad Bravo' });
    expect(expanded).toHaveAttribute('aria-expanded', 'true');
    const detail = document.getElementById(expanded.getAttribute('aria-controls') ?? '') as HTMLElement;
    expect(detail).toHaveClass('md:hidden');
    expect(within(detail).getAllByRole('term').map((t) => t.textContent)).toEqual(['Jogos', 'Vitórias', 'Empates', 'Derrotas', 'Saldo', 'Pró / contra']);
    expect(within(detail).getAllByRole('definition').map((d) => d.textContent)).toEqual(['3', '2', '0', '1', '+2', '8 / 2']);
  });
});

describe('animação e anúncio quando a tabela muda sozinha', () => {
  const before = [standingRow(1, { name: 'Alfa', points: 9 }), standingRow(2, { name: 'Bravo', points: 6 }), standingRow(3, { name: 'Charlie', points: 3 })];
  const after = [
    { ...(before[1] as StandingRow), position: 1, points: 12 },
    { ...(before[0] as StandingRow), position: 2 },
    before[2] as StandingRow,
  ];
  let animate: ReturnType<typeof vi.fn>;
  let restore: () => void;

  beforeEach(() => {
    animate = vi.fn();
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop');
    // jsdom não faz layout: a "altura" de cada linha é a posição dela na tabela.
    Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
      configurable: true,
      get(this: HTMLElement) {
        return [...(this.parentElement?.children ?? [])].indexOf(this) * 40;
      },
    });
    HTMLElement.prototype.animate = animate as unknown as HTMLElement['animate'];
    restore = () => {
      if (original) Object.defineProperty(HTMLElement.prototype, 'offsetTop', original);
      delete (HTMLElement.prototype as { animate?: unknown }).animate;
    };
  });
  afterEach(() => restore());

  it('FLIP: as linhas que trocaram de lugar animam do lugar antigo para o novo', () => {
    const view = render(<StandingsTable rows={before} caption="Classificação" />);
    expect(animate).not.toHaveBeenCalled(); // nada anima na primeira pintura
    view.rerender(<StandingsTable rows={after} caption="Classificação" />);
    expect(names(screen.getByRole('table'))).toEqual(['Bravo', 'Alfa', 'Charlie']);
    expect(animate).toHaveBeenCalledTimes(2); // Charlie não saiu do lugar
    expect(animate.mock.calls.map((c) => (c[0] as { transform: string }[])[0]?.transform).sort()).toEqual(['translateY(-40px)', 'translateY(40px)']);
  });

  it('respeita prefers-reduced-motion: reordena sem animar', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('prefers-reduced-motion'), media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    const view = render(<StandingsTable rows={before} caption="Classificação" />);
    view.rerender(<StandingsTable rows={after} caption="Classificação" />);
    expect(names(screen.getByRole('table'))).toEqual(['Bravo', 'Alfa', 'Charlie']);
    expect(animate).not.toHaveBeenCalled();
  });

  it('aria-live="polite" anuncia a mudança de forma resumida, e só quando algo muda', () => {
    const view = render(<StandingsTable rows={before} caption="Classificação" highlightRegistrationId="r1" />);
    const live = screen.getByTestId('standings-announcement');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toBeEmptyDOMElement();
    view.rerender(<StandingsTable rows={[...before]} caption="Classificação" highlightRegistrationId="r1" />);
    expect(live).toBeEmptyDOMElement();
    view.rerender(<StandingsTable rows={after} caption="Classificação" highlightRegistrationId="r1" />);
    expect(live).toHaveTextContent('Classificação atualizada: Alfa (você) caiu para 2º; Bravo subiu para 1º.');
  });

  it('summarizeChanges', () => {
    expect(summarizeChanges(before, before)).toBe('');
    expect(summarizeChanges(before, after)).toBe('Classificação atualizada: Bravo subiu para 1º; Alfa caiu para 2º.');
    expect(summarizeChanges(before, [{ ...(before[0] as StandingRow), points: 10 }, ...before.slice(1)])).toBe('Classificação atualizada: os pontos mudaram, as posições não.');
    // Outra tabela (outro grupo): nada a anunciar.
    expect(summarizeChanges(before, [standingRow(1, { registrationId: 'x1' }), standingRow(2, { registrationId: 'x2' })])).toBe('');
    // Muitas mudanças: fala as três primeiras e resume o resto.
    const many = Array.from({ length: 6 }, (_, i) => standingRow(i + 1));
    const reversed = [...many].reverse().map((r, i) => ({ ...r, position: i + 1 }));
    expect(summarizeChanges(many, reversed)).toBe('Classificação atualizada: Squad 6 subiu para 1º; Squad 5 subiu para 2º; Squad 4 subiu para 3º; e mais 3 mudanças.');
  });

  it('números: saldo com sinal e pontos sem zeros à toa', () => {
    expect([formatDiff(3), formatDiff(0), formatDiff(-2)]).toEqual(['+3', '0', '−2']);
    expect([formatPoints(10), formatPoints(7.5)]).toEqual(['10', '7,5']);
  });
});

describe('BRStandingsTable — acumulado e por queda', () => {
  const rows = [
    standingRow(1, { name: 'Squad Alfa', booyahs: 2, kills: 21, points: 27, qualifying: true, perDrop: drops([[1, 7, 10], [2, 9, 9], [1, 5, 8]]) }),
    standingRow(2, { name: 'Squad Bravo', booyahs: 1, kills: 15, points: 18, qualifying: true, perDrop: drops([[2, 9, 9], [1, 6, 9], [null, 0, 0]]) }),
    standingRow(3, { name: 'Squad Charlie', booyahs: 0, kills: 11, points: 11, perDrop: drops([[3, 4, 4], [3, 3, 3], [2, 4, 4]]) }),
  ];

  it('acumulado: Pos, Squad, Booyahs, Kills e Pts', () => {
    render(<BRStandingsTable rows={rows} caption="Classificação do Grupo A" />);
    const table = screen.getByRole('table', { name: 'Classificação do Grupo A (acumulado)' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Pos', 'Squad', 'Booyahs', 'Kills', 'Pts', 'Mais números']);
    expect(within(dataRows(table)[0] as HTMLElement).getAllByRole('cell').slice(1, 4).map((c) => c.textContent)).toEqual(['2', '21', '27']);
    expect(screen.getByRole('button', { name: 'Acumulado' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Por queda' })).toHaveAttribute('aria-pressed', 'false');
    expect(dataRows(table)[0]).toHaveClass('bg-primary-soft');
  });

  it('por queda: uma coluna por queda com pontos, colocação e kills de `perDrop`, mantendo a ordem e o total', async () => {
    const user = userEvent.setup();
    render(<BRStandingsTable rows={rows} caption="Classificação do Grupo A" />);
    await user.click(screen.getByRole('button', { name: 'Por queda' }));
    expect(screen.getByRole('button', { name: 'Por queda' })).toHaveAttribute('aria-pressed', 'true');
    const table = screen.getByRole('table', { name: 'Classificação do Grupo A (por queda)' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Pos', 'Squad', 'Q1', 'Q2', 'Q3', 'Pts', 'Mais números']);
    expect(within(within(table).getAllByRole('columnheader')[2] as HTMLElement).getByTitle('Queda 1')).toBeInTheDocument();
    expect(names(table)).toEqual([expect.stringContaining('Squad Alfa'), expect.stringContaining('Squad Bravo'), expect.stringContaining('Squad Charlie')]);
    const alfa = within(dataRows(table)[0] as HTMLElement).getAllByRole('cell');
    expect(alfa.slice(1, 5).map((c) => c.textContent)).toEqual(['101º · 7 K', '92º · 9 K', '81º · 5 K', '27']);
    const bravo = within(dataRows(table)[1] as HTMLElement).getAllByRole('cell');
    expect(bravo[3]).toHaveTextContent('0ausente');

    await user.click(screen.getByRole('button', { name: 'Acumulado' }));
    expect(screen.getByRole('table', { name: 'Classificação do Grupo A (acumulado)' })).toBeInTheDocument();
  });

  it('no celular, a linha expansível do acumulado lista cada queda', async () => {
    const user = userEvent.setup();
    render(<BRStandingsTable rows={rows} caption="Classificação" />);
    await user.click(screen.getByRole('button', { name: 'Ver os números de Squad Bravo' }));
    const detail = document.getElementById(screen.getByRole('button', { name: 'Esconder os números de Squad Bravo' }).getAttribute('aria-controls') ?? '') as HTMLElement;
    expect(within(detail).getAllByRole('term').map((t) => t.textContent)).toEqual(['Booyahs', 'Kills', 'Queda 1', 'Queda 2', 'Queda 3']);
    expect(within(detail).getAllByRole('definition').map((d) => d.textContent)).toEqual(['1', '15', '2º · 9 kills · 9 pts', '1º · 6 kills · 9 pts', 'ausente']);
  });

  it('por queda sem nenhum resultado explica que ainda não há números', async () => {
    const user = userEvent.setup();
    render(<BRStandingsTable rows={rows.map((r) => ({ ...r, perDrop: [] }))} caption="Classificação" defaultMode="TOTAL" />);
    await user.click(screen.getByRole('button', { name: 'Por queda' }));
    expect(screen.getByText(/Nenhuma queda tem resultado ainda/)).toBeInTheDocument();
  });

  it('48 squads: a tabela continua de largura fixa (sem empurrar a página em 360 px)', () => {
    const many = Array.from({ length: 48 }, (_, i) => standingRow(i + 1, { name: `Squad com um nome bem comprido número ${i + 1}`, qualifying: i < 8 }));
    render(<BRStandingsTable rows={many} caption="Classificação" />);
    const table = screen.getByRole('table');
    expect(dataRows(table)).toHaveLength(48);
    expect(table).toHaveClass('table-fixed', 'w-full');
    // O nome comprido é cortado com reticências em vez de alargar a coluna.
    expect(within(dataRows(table)[0] as HTMLElement).getByText(/Squad com um nome bem comprido/)).toHaveClass('truncate');
  });
});

describe('GroupTable e StageStandings', () => {
  const group = (id: string, name: string, offset: number): Standings['groups'][number] => ({
    groupId: id,
    name,
    rows: [1, 2, 3].map((p) => standingRow(p, { registrationId: `${id}-r${p}`, name: `${name} · Squad ${p + offset}`, groupId: id, qualifying: p <= 2 })),
  });
  const groups = [group('g1', 'Grupo A', 0), group('g2', 'Grupo B', 10)];
  const standings = (patch: Partial<Standings> = {}): Standings => ({ stageId: 'st_1', format: 'GROUPS', matchType: 'BATTLE_ROYALE', groups, overall: groups.flatMap((g) => g.rows), drawUsed: false, drawSeed: null, mvp: [], updatedAt: '2026-11-12T00:00:00.000Z', ...patch });

  it('uma tabela por grupo; no celular, seletor de grupo (começa no grupo de quem está vendo)', async () => {
    const user = userEvent.setup();
    render(<GroupTable groups={groups} matchType="BATTLE_ROYALE" highlightRegistrationId="g2-r1" />);
    expect(screen.getAllByRole('table')).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Grupo A' })).toBeInTheDocument();
    const select = screen.getByRole('combobox', { name: 'Grupo' });
    expect(select.closest('.md\\:hidden')).not.toBeNull(); // o seletor só existe no celular
    expect(select).toHaveValue('g2');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Grupo A', 'Grupo B (o seu)']);
    const sectionA = screen.getByRole('region', { name: 'Grupo A' });
    const sectionB = screen.getByRole('region', { name: 'Grupo B' });
    expect(sectionA).toHaveClass('hidden', 'md:flex'); // escondido no celular, visível a partir de 768 px
    expect(sectionB).toHaveClass('flex');
    await user.selectOptions(select, 'g1');
    expect(sectionA).toHaveClass('flex');
    expect(sectionB).toHaveClass('hidden', 'md:flex');
  });

  it('StageStandings escolhe a tabela pelo formato: grupos, BR ou duelos', () => {
    const { unmount } = render(<StageStandings standings={standings()} />);
    expect(screen.getAllByRole('table')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Por queda' })).toHaveLength(2);
    unmount();

    const single = render(<StageStandings standings={standings({ format: 'BATTLE_ROYALE', groups: [{ groupId: null, name: 'Classificação', rows: groups[0]?.rows ?? [] }], overall: groups[0]?.rows ?? [] })} />);
    expect(screen.getAllByRole('table')).toHaveLength(1);
    expect(screen.getByRole('columnheader', { name: 'Squad' })).toBeInTheDocument();
    single.unmount();

    render(<StageStandings standings={standings({ format: 'SWISS', matchType: 'DUEL', groups: [{ groupId: null, name: 'Classificação', rows: groups[0]?.rows ?? [] }], overall: groups[0]?.rows ?? [] })} participantHeader="Jogador" />);
    expect(screen.getByRole('columnheader', { name: 'Jogador' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Por queda' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Saldo' })).toBeInTheDocument();
  });

  it('ranking de MVP aparece só quando existe', () => {
    const { unmount } = render(<StageStandings standings={standings()} />);
    expect(screen.queryByRole('heading', { name: 'Ranking de MVP' })).not.toBeInTheDocument();
    unmount();
    render(
      <StageStandings
        standings={standings({
          mvp: [
            { userId: 'u1', nickname: 'KauePro1', teamName: 'Squad Alfa', kills: 14 },
            { userId: 'u2', nickname: 'NinaZz10', teamName: 'Squad Bravo', kills: 11 },
          ],
        })}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Ranking de MVP' })).toBeInTheDocument();
    const items = within(screen.getByRole('list', { name: 'Jogadores com mais kills' })).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['1KauePro1Squad Alfa14 kills', '2NinaZz10Squad Bravo11 kills']);
  });

  it('a seed do sorteio só é repassada quando houve sorteio', async () => {
    const user = userEvent.setup();
    const row = standingRow(1, { tiebreakNote: 'Desempate por sorteio.' });
    const base = { format: 'SWISS' as const, matchType: 'DUEL' as const, groups: [{ groupId: null, name: 'Classificação', rows: [row] }], overall: [row] };
    const { unmount } = render(<StageStandings standings={standings({ ...base, drawUsed: false, drawSeed: 'nao-usada' })} />);
    await user.click(screen.getByRole('button', { name: /1º lugar/ }));
    expect(await screen.findByTestId('tiebreak-popover')).not.toHaveTextContent('Seed do sorteio');
    unmount();
    render(<StageStandings standings={standings({ ...base, drawUsed: true, drawSeed: 'open-8ball-2026' })} />);
    await user.click(screen.getByRole('button', { name: /1º lugar/ }));
    expect(await screen.findByTestId('tiebreak-popover')).toHaveTextContent('Seed do sorteio: open-8ball-2026');
  });
});
