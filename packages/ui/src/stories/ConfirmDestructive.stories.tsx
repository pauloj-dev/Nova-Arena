import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Button } from '../components/Button';
import { ConfirmDestructive } from '../components/Overlay';
import { tournament } from './fixtures';

const meta = {
  title: 'Sobreposição/ConfirmDestructive',
  component: ConfirmDestructive,
  args: {
    open: true,
    onOpenChange: () => {},
    onConfirm: () => {},
    title: 'Cancelar campeonato',
    description: 'Os 37 squads inscritos serão avisados. Isso não pode ser desfeito.',
    confirmText: tournament.name,
    confirmLabel: 'Cancelar campeonato',
  },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ConfirmDestructive>;

export default meta;
type Story = StoryObj<typeof meta>;

function ConfirmDemo({ loading, withDetails }: { loading?: boolean; withDetails?: boolean }) {
  const [open, setOpen] = useState(true);
  const [done, setDone] = useState(false);
  return (
    <div className="flex flex-col items-start gap-3 p-6">
      <Button variant="danger" onClick={() => setOpen(true)}>
        Cancelar campeonato
      </Button>
      {done && <p className="text-sm text-muted">Campeonato cancelado.</p>}
      <ConfirmDestructive
        open={open}
        onOpenChange={setOpen}
        title="Cancelar campeonato"
        description="Os 37 squads inscritos serão avisados. Isso não pode ser desfeito."
        confirmText={tournament.name}
        confirmLabel="Cancelar campeonato"
        loading={loading}
        onConfirm={() => {
          setDone(true);
          setOpen(false);
        }}
      >
        {withDetails && (
          <ul className="list-disc pl-5 text-sm text-text">
            <li>As inscrições são encerradas agora.</li>
            <li>As quedas já jogadas continuam no histórico dos squads.</li>
          </ul>
        )}
      </ConfirmDestructive>
    </div>
  );
}

export const Aberto: Story = { render: () => <ConfirmDemo /> };

export const ComDetalhes: Story = { name: 'Com detalhes', render: () => <ConfirmDemo withDetails /> };

export const Enviando: Story = { render: () => <ConfirmDemo loading /> };
