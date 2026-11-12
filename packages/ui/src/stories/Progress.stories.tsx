import type { Meta, StoryObj } from '@storybook/react-vite';
import { Progress } from '../components/Surface';

const meta = {
  title: 'Feedback/Progress',
  component: Progress,
  args: { value: 37, max: 48, label: 'Vagas preenchidas' },
  decorators: [(Story) => <div className="max-w-sm">{Story()}</div>],
} satisfies Meta<typeof Progress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Padrao: Story = { name: 'Padrão' };

export const Vazio: Story = { args: { value: 0 } };

export const Cheio: Story = { args: { value: 48 } };

export const AcimaDoTotal: Story = {
  name: 'Acima do total (a barra para em 100%)',
  args: { value: 53, max: 48, label: 'Inscrições recebidas' },
};

export const Escala: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {[4, 12, 24, 37, 48].map((v) => (
        <Progress key={v} value={v} max={48} label={`Vagas preenchidas: ${v} de 48`} />
      ))}
    </div>
  ),
};
