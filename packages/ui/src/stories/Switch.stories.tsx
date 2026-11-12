import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Switch } from '../components/Toggle';

const meta = {
  title: 'Formulário/Switch',
  component: Switch,
  args: { label: 'Inscrições abertas', checked: false, onCheckedChange: () => {} },
  decorators: [(Story) => <div className="max-w-sm">{Story()}</div>],
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

function SwitchDemo(props: { label: string; hint?: string; initial?: boolean; disabled?: boolean }) {
  const [checked, setChecked] = useState(props.initial ?? false);
  return <Switch label={props.label} hint={props.hint} checked={checked} onCheckedChange={setChecked} disabled={props.disabled} />;
}

export const Desligado: Story = {
  render: () => <SwitchDemo label="Inscrições abertas" />,
};

export const Ligado: Story = {
  render: () => <SwitchDemo label="Inscrições abertas" initial />,
};

export const ComDica: Story = {
  name: 'Com dica',
  render: () => <SwitchDemo label="Aprovar inscrições manualmente" hint="Cada squad fica pendente até você aprovar." initial />,
};

export const Desabilitado: Story = {
  render: () => (
    <div className="flex flex-col">
      <SwitchDemo label="Lista de espera" hint="Disponível depois que as vagas acabarem." disabled />
      <SwitchDemo label="Transmissão ao vivo" hint="Ligada pela organização." initial disabled />
    </div>
  ),
};
