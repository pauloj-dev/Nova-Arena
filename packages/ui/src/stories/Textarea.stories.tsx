import type { Meta, StoryObj } from '@storybook/react-vite';
import { Textarea } from '../components/Field';

const meta = {
  title: 'Formulário/Textarea',
  component: Textarea,
  args: { label: 'Regras do campeonato', placeholder: 'Descreva o formato, os horários e o que leva à desclassificação.' },
  decorators: [(Story) => <div className="max-w-md">{Story()}</div>],
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Padrao: Story = { name: 'Padrão' };

export const ComDica: Story = {
  name: 'Com dica',
  args: { hint: 'Aparece na página pública do campeonato.', rows: 6 },
};

export const ComErro: Story = {
  name: 'Com erro',
  args: {
    label: 'Motivo da disputa',
    required: true,
    defaultValue: 'Kill errada',
    error: 'Explique o que aconteceu com pelo menos 20 caracteres.',
  },
};

export const Desabilitado: Story = {
  args: { disabled: true, defaultValue: 'Squads de 4 jogadores. Check-in até 30 minutos antes da primeira queda. Uso de emulador desclassifica o squad.' },
};
