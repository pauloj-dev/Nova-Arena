import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Checkbox } from '../components/Toggle';

const meta = {
  title: 'Formulário/Checkbox',
  component: Checkbox,
  args: { label: 'Li e aceito o regulamento do campeonato', checked: false, onCheckedChange: () => {} },
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

function CheckboxDemo(props: { label: string; hint?: string; initial?: boolean; disabled?: boolean }) {
  const [checked, setChecked] = useState(props.initial ?? false);
  return <Checkbox label={props.label} hint={props.hint} checked={checked} onCheckedChange={setChecked} disabled={props.disabled} />;
}

export const Padrao: Story = {
  name: 'Padrão',
  render: () => <CheckboxDemo label="Li e aceito o regulamento do campeonato" />,
};

export const Marcado: Story = {
  render: () => <CheckboxDemo label="Li e aceito o regulamento do campeonato" initial />,
};

export const ComDica: Story = {
  name: 'Com dica',
  render: () => <CheckboxDemo label="Exigir check-in" hint="O squad que não confirmar presença até 30 minutos antes perde a vaga." initial />,
};

export const Desabilitado: Story = {
  render: () => (
    <div className="flex flex-col">
      <CheckboxDemo label="Permitir emulador" hint="Bloqueado pelo regulamento da liga." disabled />
      <CheckboxDemo label="Somente jogadores verificados" hint="Definido pela organização." initial disabled />
    </div>
  ),
};

export const Lista: Story = {
  render: () => (
    <fieldset className="flex flex-col">
      <legend className="mb-1 text-sm font-semibold text-text">Avisos por e-mail</legend>
      <CheckboxDemo label="Quando o check-in abrir" initial />
      <CheckboxDemo label="Quando minha próxima queda for marcada" initial />
      <CheckboxDemo label="Quando o resultado for validado" />
    </fieldset>
  ),
};
