import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Button } from '../components/Button';
import { Stepper, type StepperProps } from '../components/Stepper';
import { wizardSteps } from './fixtures';

const meta = {
  title: 'Navegação/Stepper',
  component: Stepper,
  args: { steps: wizardSteps, current: 2, reached: 4, orientation: 'horizontal' },
  argTypes: { orientation: { control: 'inline-radio', options: ['horizontal', 'vertical'] }, steps: { control: false } },
} satisfies Meta<typeof Stepper>;

export default meta;
type Story = StoryObj<typeof meta>;

function StepperDemo({ orientation, initial = 2 }: Pick<StepperProps, 'orientation'> & { initial?: number }) {
  const [current, setCurrent] = useState(initial);
  const [reached, setReached] = useState(initial);
  const go = (index: number) => {
    setCurrent(index);
    setReached((r) => Math.max(r, index));
  };
  const last = wizardSteps.length - 1;
  return (
    <div className={orientation === 'vertical' ? 'flex flex-col gap-6 md:flex-row' : 'flex flex-col gap-6'}>
      <Stepper steps={wizardSteps} current={current} reached={reached} onStepClick={go} orientation={orientation} className={orientation === 'vertical' ? 'md:w-64' : undefined} />
      <div className="flex flex-1 flex-col gap-4">
        <h3 className="text-lg text-text">{wizardSteps[current]?.label}</h3>
        <p className="text-sm text-muted">{wizardSteps[current]?.description}</p>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={current === 0} onClick={() => go(current - 1)}>
            Voltar
          </Button>
          <Button disabled={current === last} onClick={() => go(current + 1)}>
            Continuar
          </Button>
        </div>
      </div>
    </div>
  );
}

export const Horizontal: Story = { render: () => <StepperDemo orientation="horizontal" /> };

export const Vertical: Story = { render: () => <StepperDemo orientation="vertical" /> };

export const PrimeiroPasso: Story = { name: 'Primeiro passo', args: { current: 0, reached: 0 } };

export const UltimoPasso: Story = { name: 'Último passo', args: { current: 6, reached: 6 } };

export const SemClique: Story = {
  name: 'Sem clique (só leitura)',
  args: { current: 3, onStepClick: undefined },
};

export const NoCelular: Story = {
  name: 'No celular (resumo + barra)',
  render: () => <StepperDemo orientation="horizontal" />,
  globals: { viewport: { value: 'mobile1', isRotated: false } },
};
