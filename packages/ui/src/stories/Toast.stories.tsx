import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { Button } from '../components/Button';
import { ToastProvider, useToast } from '../components/Toast';

const meta = {
  title: 'Feedback/Toast',
  component: ToastProvider,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <ToastProvider>
        <div className="min-h-80 p-6">{Story()}</div>
      </ToastProvider>
    ),
  ],
} satisfies Meta<typeof ToastProvider>;

export default meta;
type Story = StoryObj;

function Triggers() {
  const { toast, success, error } = useToast();
  return (
    <div className="flex flex-wrap gap-3">
      <Button onClick={() => success('Inscrição confirmada', 'O squad Fúria Nordestina está na Copa Booyah de Verão.')}>Sucesso</Button>
      <Button variant="danger" onClick={() => error('Não deu para enviar o resultado', 'Confira a conexão e tente de novo.')}>
        Erro
      </Button>
      <Button variant="secondary" onClick={() => toast({ title: 'Check-in abre em 15 minutos' })}>
        Informação
      </Button>
      <Button variant="ghost" onClick={() => toast({ title: 'Senha da sala copiada', description: 'Este aviso fica até você fechar.', duration: 0 })}>
        Sem tempo para sumir
      </Button>
    </div>
  );
}

export const Interativo: Story = { render: () => <Triggers /> };

/** Mostra os três tons de uma vez, sem sumir, para revisão visual. */
function AllTones() {
  const { toast } = useToast();
  useEffect(() => {
    toast({ title: 'Check-in abre em 15 minutos', tone: 'info', duration: 0 });
    toast({ title: 'Inscrição confirmada', description: 'O squad Fúria Nordestina está na Copa Booyah de Verão.', tone: 'success', duration: 0 });
    toast({ title: 'Não deu para enviar o resultado', description: 'Confira a conexão e tente de novo.', tone: 'error', duration: 0 });
  }, [toast]);
  return <p className="text-sm text-muted">Os avisos aparecem no canto da tela e são lidos por leitores de tela sem tirar o foco de onde a pessoa está.</p>;
}

export const TodosOsTons: Story = { name: 'Todos os tons', render: () => <AllTones /> };
