import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Button } from '../components/Button';
import { Input, Select } from '../components/Field';
import { Modal, type ModalProps } from '../components/Overlay';

const meta = {
  title: 'Sobreposição/Modal',
  component: Modal,
  args: { open: true, onOpenChange: () => {}, title: 'Convidar jogador', size: 'md' },
  argTypes: { size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] }, footer: { control: false }, children: { control: false } },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Modal>;

export default meta;
type Story = StoryObj<typeof meta>;

function ModalDemo({ initialOpen = true, ...props }: Partial<ModalProps> & { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <div className="p-6">
      <Button onClick={() => setOpen(true)}>Convidar jogador</Button>
      <Modal
        title="Convidar jogador"
        description="O convite vale por 48 horas. A pessoa entra no squad assim que aceitar."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => setOpen(false)}>Enviar convite</Button>
          </>
        }
        {...props}
        open={open}
        onOpenChange={setOpen}
      >
        {props.children ?? (
          <div className="flex flex-col gap-4">
            <Input label="E-mail ou apelido" placeholder="rafa.monteiro" required />
            <Select
              label="Função no squad"
              defaultValue="titular"
              options={[
                { value: 'titular', label: 'Titular' },
                { value: 'reserva', label: 'Reserva' },
              ]}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}

export const Aberto: Story = { render: (args) => <ModalDemo size={args.size} /> };

export const Fechado: Story = {
  name: 'Fechado (abre pelo botão)',
  render: () => <ModalDemo initialOpen={false} />,
};

export const Pequeno: Story = {
  render: () => (
    <ModalDemo size="sm" title="Sair do squad?" description="Você perde a vaga na Copa Booyah de Verão.">
      <p className="text-sm text-text">O capitão é avisado e pode convidar outra pessoa.</p>
    </ModalDemo>
  ),
};

export const Grande: Story = {
  render: () => (
    <ModalDemo size="lg" title="Regulamento" description={undefined} footer={undefined}>
      <div className="flex flex-col gap-3 text-sm text-text">
        {Array.from({ length: 12 }, (_, i) => (
          <p key={i}>
            <strong>{i + 1}.</strong> Cada squad joga as 6 quedas da fase classificatória. A pontuação soma a colocação e as kills de cada queda; em caso de empate, vale o maior número de Booyahs.
          </p>
        ))}
      </div>
    </ModalDemo>
  ),
};

export const SemDescricaoNemRodape: Story = {
  name: 'Sem descrição nem rodapé',
  render: () => (
    <ModalDemo title="Senha da sala" description={undefined} footer={undefined}>
      <p className="tabular text-2xl text-text">BOOYAH-4821</p>
    </ModalDemo>
  ),
};

export const NoCelular: Story = {
  name: 'No celular (tela cheia)',
  render: () => <ModalDemo />,
  globals: { viewport: { value: 'mobile1', isRotated: false } },
};
