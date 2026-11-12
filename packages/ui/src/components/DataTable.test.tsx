import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expectNoA11yViolations } from '../test/axe';
import { DataTable, type Column, type DataTableProps, type SortState } from './DataTable';

interface Squad {
  id: string;
  name: string;
  captain: string;
  points: number;
}

const squads: Squad[] = [
  { id: 'sq-1', name: 'Fúria Nordestina', captain: 'Rafaela Monteiro', points: 118 },
  { id: 'sq-2', name: 'Tropa do Rush', captain: 'Caio Ferraz', points: 109 },
  { id: 'sq-3', name: 'Los Brabos', captain: 'Thiago Antunes', points: 87 },
];

const columns: Column<Squad>[] = [
  { id: 'name', header: 'Squad', cell: (s) => s.name, sortable: true, primary: true },
  { id: 'captain', header: 'Capitão', cell: (s) => s.captain, hideOnMobile: true },
  { id: 'points', header: 'Pts', cell: (s) => s.points, sortable: true, align: 'right' },
];

type HarnessProps = Partial<DataTableProps<Squad>> & { initialSort?: SortState | null; initialSelected?: string[]; initialPage?: number };

/** Guarda ordenação, seleção e página, como a tela faria. */
function Harness({ initialSort = null, initialSelected, initialPage, onSortChange, onSelectedChange, onPageChange, ...props }: HarnessProps) {
  const [sort, setSort] = useState<SortState | null>(initialSort);
  const [selected, setSelected] = useState(initialSelected ?? []);
  const [page, setPage] = useState(initialPage ?? 1);
  return (
    <DataTable
      caption="Squads inscritos"
      columns={columns}
      rows={squads}
      getRowId={(s) => s.id}
      sort={sort}
      onSortChange={(s) => {
        onSortChange?.(s);
        setSort(s);
      }}
      selected={initialSelected ? selected : undefined}
      onSelectedChange={
        initialSelected
          ? (ids) => {
              onSelectedChange?.(ids);
              setSelected(ids);
            }
          : undefined
      }
      page={initialPage ? page : undefined}
      onPageChange={(p) => {
        onPageChange?.(p);
        setPage(p);
      }}
      {...props}
    />
  );
}

const table = () => screen.getByRole('table', { name: 'Squads inscritos' });
const header = (name: string) => within(table()).getByRole('columnheader', { name: new RegExp(`^${name}`) });
const bodyRows = () => within(table()).getAllByRole('row').slice(1);

describe('DataTable', () => {
  it('monta a tabela com legenda, cabeçalhos de coluna e uma linha por registro', () => {
    render(<Harness />);
    expect(within(table()).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Squad', 'Capitão', 'Pts']);
    for (const th of within(table()).getAllByRole('columnheader')) expect(th).toHaveAttribute('scope', 'col');
    expect(bodyRows()).toHaveLength(3);
    expect(within(bodyRows()[0] as HTMLElement).getAllByRole('cell').map((td) => td.textContent)).toEqual(['Fúria Nordestina', 'Rafaela Monteiro', '118']);
  });

  it('respeita o alinhamento da coluna', () => {
    render(<Harness />);
    expect(header('Pts')).toHaveClass('text-right');
    expect(within(bodyRows()[0] as HTMLElement).getByRole('cell', { name: '118' })).toHaveClass('text-right');
  });

  describe('ordenação', () => {
    it('só as colunas ordenáveis têm botão', () => {
      render(<Harness />);
      expect(within(header('Squad')).getByRole('button', { name: 'Squad' })).toBeInTheDocument();
      expect(within(header('Pts')).getByRole('button', { name: 'Pts' })).toBeInTheDocument();
      expect(within(header('Capitão')).queryByRole('button')).not.toBeInTheDocument();
    });

    it('sem onSortChange nenhuma coluna vira botão', () => {
      render(<DataTable caption="Squads inscritos" columns={columns} rows={squads} getRowId={(s) => s.id} />);
      expect(within(table()).queryByRole('button')).not.toBeInTheDocument();
    });

    it('clicar muda aria-sort: crescente → decrescente → sem ordenação', async () => {
      const user = userEvent.setup();
      const onSortChange = vi.fn();
      render(<Harness onSortChange={onSortChange} />);
      const button = within(header('Pts')).getByRole('button');
      expect(header('Pts')).not.toHaveAttribute('aria-sort');

      await user.click(button);
      expect(header('Pts')).toHaveAttribute('aria-sort', 'ascending');
      await user.click(button);
      expect(header('Pts')).toHaveAttribute('aria-sort', 'descending');
      await user.click(button);
      expect(header('Pts')).not.toHaveAttribute('aria-sort');

      expect(onSortChange.mock.calls).toEqual([[{ id: 'points', dir: 'asc' }], [{ id: 'points', dir: 'desc' }], [null]]);
    });

    it('trocar de coluna começa em crescente e tira aria-sort da anterior', async () => {
      const user = userEvent.setup();
      render(<Harness initialSort={{ id: 'points', dir: 'desc' }} />);
      expect(header('Pts')).toHaveAttribute('aria-sort', 'descending');
      await user.click(within(header('Squad')).getByRole('button'));
      expect(header('Squad')).toHaveAttribute('aria-sort', 'ascending');
      expect(header('Pts')).not.toHaveAttribute('aria-sort');
    });

    it('funciona pelo teclado (Tab + Enter)', async () => {
      const user = userEvent.setup();
      render(<Harness />);
      await user.tab();
      expect(within(header('Squad')).getByRole('button')).toHaveFocus();
      await user.keyboard('{Enter}');
      expect(header('Squad')).toHaveAttribute('aria-sort', 'ascending');
    });
  });

  describe('seleção', () => {
    const selectAll = () => within(table()).getByRole('checkbox', { name: 'Selecionar todas as linhas' });
    const rowBoxes = () => within(table()).getAllByRole('checkbox', { name: 'Selecionar linha' });

    it('sem onSelectedChange não há caixas de seleção', () => {
      render(<Harness />);
      expect(within(table()).queryByRole('checkbox')).not.toBeInTheDocument();
    });

    it('"selecionar todas" marca todas as linhas e mostra a barra de ações em lote', async () => {
      const user = userEvent.setup();
      const onSelectedChange = vi.fn();
      render(<Harness initialSelected={[]} onSelectedChange={onSelectedChange} bulkActions={<button type="button">Aprovar inscrições</button>} />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();

      await user.click(selectAll());
      expect(onSelectedChange).toHaveBeenLastCalledWith(['sq-1', 'sq-2', 'sq-3']);
      expect(selectAll()).toBeChecked();
      for (const box of rowBoxes()) expect(box).toBeChecked();
      const bar = screen.getByRole('status');
      expect(bar).toHaveTextContent('3 selecionados');
      expect(within(bar).getByRole('button', { name: 'Aprovar inscrições' })).toBeInTheDocument();
    });

    it('com todas marcadas, "selecionar todas" desmarca tudo', async () => {
      const user = userEvent.setup();
      const onSelectedChange = vi.fn();
      render(<Harness initialSelected={['sq-1', 'sq-2', 'sq-3']} onSelectedChange={onSelectedChange} />);
      await user.click(selectAll());
      expect(onSelectedChange).toHaveBeenLastCalledWith([]);
      for (const box of rowBoxes()) expect(box).not.toBeChecked();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('marcar uma linha de cada vez; "selecionar todas" só fica marcada quando todas estão', async () => {
      const user = userEvent.setup();
      render(<Harness initialSelected={[]} />);
      await user.click(rowBoxes()[1] as HTMLElement);
      expect(screen.getByRole('status')).toHaveTextContent('1 selecionado');
      expect(screen.getByRole('status')).not.toHaveTextContent('selecionados');
      expect(selectAll()).not.toBeChecked();
      await user.click(rowBoxes()[0] as HTMLElement);
      await user.click(rowBoxes()[2] as HTMLElement);
      expect(selectAll()).toBeChecked();
      await user.click(rowBoxes()[1] as HTMLElement);
      expect(selectAll()).not.toBeChecked();
      expect(screen.getByRole('status')).toHaveTextContent('2 selecionados');
    });

    it('funciona pelo teclado (Espaço)', async () => {
      const user = userEvent.setup();
      render(<Harness initialSelected={[]} />);
      selectAll().focus();
      await user.keyboard(' ');
      expect(selectAll()).toBeChecked();
    });
  });

  describe('paginação', () => {
    const nav = () => screen.getByRole('navigation', { name: 'Paginação' });

    it('mostra página, total e avança', async () => {
      const user = userEvent.setup();
      const onPageChange = vi.fn();
      render(<Harness initialPage={1} pageCount={3} total={9} onPageChange={onPageChange} />);
      expect(nav()).toHaveTextContent('Página 1 de 3 · 9 no total');
      expect(within(nav()).getByRole('button', { name: 'Anterior' })).toBeDisabled();
      await user.click(within(nav()).getByRole('button', { name: 'Próxima' }));
      expect(onPageChange).toHaveBeenLastCalledWith(2);
      expect(nav()).toHaveTextContent('Página 2 de 3');
      expect(within(nav()).getByRole('button', { name: 'Anterior' })).toBeEnabled();
    });

    it('na última página "Próxima" fica bloqueado e "Anterior" volta', async () => {
      const user = userEvent.setup();
      const onPageChange = vi.fn();
      render(<Harness initialPage={3} pageCount={3} onPageChange={onPageChange} />);
      expect(within(nav()).getByRole('button', { name: 'Próxima' })).toBeDisabled();
      await user.click(within(nav()).getByRole('button', { name: 'Anterior' }));
      expect(onPageChange).toHaveBeenLastCalledWith(2);
    });

    it('com uma página só (ou sem página) não mostra a paginação', () => {
      const { rerender } = render(<Harness initialPage={1} pageCount={1} />);
      expect(screen.queryByRole('navigation', { name: 'Paginação' })).not.toBeInTheDocument();
      rerender(<Harness />);
      expect(screen.queryByRole('navigation', { name: 'Paginação' })).not.toBeInTheDocument();
    });
  });

  describe('estados', () => {
    it('vazia mostra a mensagem padrão', () => {
      render(<Harness rows={[]} />);
      expect(screen.getByText('Nada por aqui ainda.')).toBeInTheDocument();
      expect(bodyRows()).toHaveLength(0);
    });

    it('vazia aceita um estado vazio próprio, com ação', () => {
      render(
        <Harness
          rows={[]}
          empty={
            <div>
              <p>Nenhum squad inscrito ainda</p>
              <button type="button">Copiar link de inscrição</button>
            </div>
          }
        />,
      );
      expect(screen.getByText('Nenhum squad inscrito ainda')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Copiar link de inscrição' })).toBeInTheDocument();
      expect(screen.queryByText('Nada por aqui ainda.')).not.toBeInTheDocument();
    });

    it('carregando mostra skeletons no lugar das linhas, sem a mensagem de vazio', () => {
      const { container } = render(<Harness rows={[]} loading />);
      expect(screen.queryByText('Nada por aqui ainda.')).not.toBeInTheDocument();
      expect(bodyRows()).toHaveLength(5);
      expect(container.querySelectorAll('.animate-skeleton').length).toBeGreaterThanOrEqual(5);
    });

    it('carregando esconde as linhas antigas', () => {
      render(<Harness loading />);
      expect(within(table()).queryByText('Fúria Nordestina')).not.toBeInTheDocument();
    });
  });

  it('rowActions cria a coluna "Ações" com a ação de cada linha', async () => {
    const user = userEvent.setup();
    const onView = vi.fn();
    render(
      <Harness
        rowActions={(s) => (
          <button type="button" onClick={() => onView(s.id)}>
            Ver {s.name}
          </button>
        )}
      />,
    );
    expect(header('Ações')).toBeInTheDocument();
    await user.click(within(table()).getByRole('button', { name: 'Ver Los Brabos' }));
    expect(onView).toHaveBeenCalledWith('sq-3');
  });

  it('no celular vira uma lista de cartões: título pela coluna primária, sem as colunas escondidas', () => {
    render(<Harness initialSelected={['sq-2']} />);
    const list = screen.getByRole('list', { name: 'Squads inscritos' });
    const cards = within(list).getAllByRole('listitem');
    expect(cards).toHaveLength(3);
    const second = within(cards[1] as HTMLElement);
    expect(second.getByText('Tropa do Rush')).toBeInTheDocument();
    expect(second.getByText('Pts')).toBeInTheDocument();
    expect(second.getByText('109')).toBeInTheDocument();
    expect(second.queryByText('Capitão')).not.toBeInTheDocument();
    expect(second.getByRole('checkbox', { name: 'Selecionar' })).toBeChecked();
  });

  it('não tem violações de acessibilidade (completa, vazia e carregando)', async () => {
    const { unmount } = render(
      <Harness
        initialSort={{ id: 'points', dir: 'desc' }}
        initialSelected={['sq-1']}
        initialPage={2}
        pageCount={3}
        total={9}
        bulkActions={<button type="button">Aprovar inscrições</button>}
        rowActions={(s) => <button type="button">Ver {s.name}</button>}
      />,
    );
    await expectNoA11yViolations();
    unmount();
    const empty = render(<Harness rows={[]} />);
    await expectNoA11yViolations();
    empty.unmount();
    render(<Harness rows={[]} loading />);
    await expectNoA11yViolations();
  });
});
