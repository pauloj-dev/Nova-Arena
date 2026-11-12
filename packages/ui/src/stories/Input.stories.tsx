import type { Meta, StoryObj } from '@storybook/react-vite';
import { Input } from '../components/Field';

const meta = {
  title: 'Formulário/Input',
  component: Input,
  args: { label: 'Nome do campeonato', placeholder: 'Ex.: Copa Booyah de Verão' },
  decorators: [(Story) => <div className="max-w-sm">{Story()}</div>],
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Padrao: Story = { name: 'Padrão' };

export const ComDica: Story = {
  name: 'Com dica',
  args: { label: 'ID do jogador no Free Fire', hint: 'Fica no seu perfil do jogo, abaixo do apelido.', inputMode: 'numeric', placeholder: '1234567890' },
};

export const Obrigatorio: Story = {
  name: 'Obrigatório',
  args: { label: 'Nome do squad', required: true, defaultValue: 'Fúria Nordestina' },
};

export const ComErro: Story = {
  name: 'Com erro',
  args: { label: 'Tag do squad', defaultValue: 'FÚRIA NORDESTINA', error: 'A tag precisa ter de 2 a 5 letras.', required: true },
};

export const Desabilitado: Story = {
  args: { label: 'Jogo', defaultValue: 'Free Fire', disabled: true, hint: 'O jogo não pode mudar depois que as inscrições abrem.' },
};

export const RotuloEscondido: Story = {
  name: 'Rótulo escondido',
  args: { label: 'Buscar campeonato', hideLabel: true, type: 'search', placeholder: 'Buscar campeonato, jogo ou organizador' },
};

export const Tipos: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Input label="E-mail" type="email" autoComplete="email" placeholder="voce@exemplo.com" />
      <Input label="Senha" type="password" autoComplete="new-password" hint="Pelo menos 8 caracteres." />
      <Input label="Vagas" type="number" min={2} max={48} defaultValue={48} />
      <Input label="Início das inscrições" type="datetime-local" />
    </div>
  ),
};
