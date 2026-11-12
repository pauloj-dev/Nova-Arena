import type { Meta, StoryObj } from '@storybook/react-vite';
import { Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { StatusPill } from '../components/Badge';
import { Button } from '../components/Button';
import { DataTable, type Column, type SortState } from '../components/DataTable';
import { Avatar, EmptyState } from '../components/Surface';
import { squads, type SquadRow } from './fixtures';

const columns: Column<SquadRow>[] = [
  {
    id: 'name',
    header: 'Squad',
    primary: true,
    sortable: true,
    cell: (s) => (
      <span className="flex items-center gap-2">
        <Avatar name={s.name} size="sm" />
        <span className="truncate">{s.name}</span>
        <span className="tabular text-xs text-muted">{s.tag}</span>
      </span>
    ),
  },
  { id: 'captain', header: 'Capitão', cell: (s) => s.captain, hideOnMobile: true },
  { id: 'status', header: 'Inscrição', cell: (s) => <StatusPill status={s.status} /> },
  { id: 'booyahs', header: 'Booyahs', align: 'right', sortable: true, cell: (s) => <span className="tabular">{s.booyahs}</span> },
  { id: 'kills', header: 'Kills', align: 'right', sortable: true, cell: (s) => <span className="tabular">{s.kills}</span> },
  { id: 'points', header: 'Pts', align: 'right', sortable: true, cell: (s) => <span className="tabular">{s.points}</span> },
];

const meta = {
  title: 'Dados/DataTable',
  component: DataTable,
  parameters: { layout: 'padded' },
} satisfies Meta;

export default meta;
type Story = StoryObj;

const PAGE_SIZE = 4;

function sortRows(rows: SquadRow[], sort: SortState | null): SquadRow[] {
  if (!sort) return rows;
  const key = sort.id as 'name' | 'booyahs' | 'kills' | 'points';
  const factor = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    return (typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y, 'pt-BR') : Number(x) - Number(y)) * factor;
  });
}

function TableDemo({ sortable, selectable, paginated, withActions }: { sortable?: boolean; selectable?: boolean; paginated?: boolean; withActions?: boolean }) {
  const [sort, setSort] = useState<SortState | null>(sortable ? { id: 'points', dir: 'desc' } : null);
  const [selected, setSelected] = useState<string[]>(selectable ? ['sq-04', 'sq-05'] : []);
  const [page, setPage] = useState(1);
  const sorted = useMemo(() => sortRows(squads, sort), [sort]);
  const rows = paginated ? sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : sorted;
  return (
    <DataTable
      caption="Squads inscritos na Copa Booyah de Verão"
      columns={columns}
      rows={rows}
      getRowId={(s) => s.id}
      sort={sortable ? sort : undefined}
      onSortChange={sortable ? setSort : undefined}
      selected={selectable ? selected : undefined}
      onSelectedChange={selectable ? setSelected : undefined}
      bulkActions={
        selectable ? (
          <>
            <Button size="sm" onClick={() => setSelected([])}>
              Aprovar inscrições
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setSelected([])}>
              Recusar
            </Button>
          </>
        ) : undefined
      }
      rowActions={
        withActions
          ? (s) => (
              <Button size="sm" variant="ghost" aria-label={`Ver squad ${s.name}`}>
                Ver squad
              </Button>
            )
          : undefined
      }
      page={paginated ? page : undefined}
      pageCount={paginated ? Math.ceil(squads.length / PAGE_SIZE) : undefined}
      total={paginated ? squads.length : undefined}
      onPageChange={paginated ? setPage : undefined}
    />
  );
}

export const Simples: Story = { render: () => <TableDemo /> };

export const ComOrdenacao: Story = { name: 'Com ordenação', render: () => <TableDemo sortable /> };

export const ComSelecao: Story = { name: 'Com seleção e ações em lote', render: () => <TableDemo selectable /> };

export const ComPaginacao: Story = { name: 'Com paginação', render: () => <TableDemo paginated /> };

export const Completa: Story = {
  name: 'Completa (ordenação, seleção, paginação e ações)',
  render: () => <TableDemo sortable selectable paginated withActions />,
};

export const Carregando: Story = {
  render: () => <DataTable caption="Squads inscritos" columns={columns} rows={[]} getRowId={(s) => s.id} loading />,
};

export const Vazia: Story = {
  name: 'Vazia (mensagem padrão)',
  render: () => <DataTable caption="Squads inscritos" columns={columns} rows={[]} getRowId={(s) => s.id} />,
};

export const VaziaComAcao: Story = {
  name: 'Vazia com ação sugerida',
  render: () => (
    <DataTable
      caption="Squads inscritos"
      columns={columns}
      rows={[]}
      getRowId={(s) => s.id}
      empty={
        <EmptyState
          icon={<Users className="size-7" />}
          title="Nenhum squad inscrito ainda"
          description="Compartilhe o link do campeonato para receber as primeiras inscrições."
          action={<Button>Copiar link de inscrição</Button>}
        />
      }
    />
  ),
};

export const NoCelular: Story = {
  name: 'No celular (cartões)',
  render: () => <TableDemo selectable paginated withActions />,
  globals: { viewport: { value: 'mobile1', isRotated: false } },
};
