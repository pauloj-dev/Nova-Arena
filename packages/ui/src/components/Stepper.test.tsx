import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoA11yViolations } from '../test/axe';
import { Stepper, type Step } from './Stepper';

const steps: Step[] = [
  { id: 'jogo', label: 'Jogo', description: 'Free Fire, Battle Royale' },
  { id: 'formato', label: 'Formato', description: 'Squads de 4' },
  { id: 'fases', label: 'Fases', description: 'Classificatória e final' },
  { id: 'pontuacao', label: 'Pontuação', description: 'Colocação e kills' },
  { id: 'revisao', label: 'Revisão', description: 'Confira tudo' },
];

function items() {
  return within(screen.getByRole('list')).getAllByRole('listitem');
}

describe('Stepper', () => {
  it('é uma navegação com nome e uma lista ordenada de passos', () => {
    render(<Stepper steps={steps} current={2} />);
    expect(screen.getByRole('navigation', { name: 'Etapas' })).toBeInTheDocument();
    expect(items()).toHaveLength(5);
  });

  it('marca só o passo atual com aria-current="step"', () => {
    render(<Stepper steps={steps} current={2} />);
    const list = items();
    expect(list[2]).toHaveAttribute('aria-current', 'step');
    expect(list[2]).toHaveTextContent('Fases');
    expect(list.filter((li) => li.hasAttribute('aria-current'))).toHaveLength(1);
  });

  it('no celular resume em "Passo 3 de 5 · Fases"', () => {
    render(<Stepper steps={steps} current={2} />);
    expect(screen.getByText('Passo 3 de 5 · Fases')).toBeInTheDocument();
  });

  it('passo concluído troca o número por um ícone; os demais mostram o número', () => {
    render(<Stepper steps={steps} current={2} />);
    const list = items();
    expect(list[0]?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(list[1]?.querySelector('svg')).toBeInTheDocument();
    expect(list[2]?.querySelector('svg')).not.toBeInTheDocument();
    expect(list[2]).toHaveTextContent('3');
    expect(list[4]).toHaveTextContent('5');
  });

  it('só os passos já alcançados (menos o atual) viram botão', () => {
    render(<Stepper steps={steps} current={1} reached={3} onStepClick={() => {}} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual([
      expect.stringContaining('Jogo'),
      expect.stringContaining('Fases'),
      expect.stringContaining('Pontuação'),
    ]);
    const list = items();
    expect(within(list[1] as HTMLElement).queryByRole('button')).not.toBeInTheDocument(); // atual
    expect(within(list[4] as HTMLElement).queryByRole('button')).not.toBeInTheDocument(); // ainda não alcançado
  });

  it('sem reached, só dá para voltar aos passos anteriores ao atual', () => {
    render(<Stepper steps={steps} current={2} onStepClick={() => {}} />);
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('clicar em um passo alcançado chama onStepClick com o índice', async () => {
    const user = userEvent.setup();
    const onStepClick = vi.fn();
    render(<Stepper steps={steps} current={2} reached={3} onStepClick={onStepClick} />);
    await user.click(screen.getByRole('button', { name: /Jogo/ }));
    await user.click(screen.getByRole('button', { name: /Pontuação/ }));
    expect(onStepClick.mock.calls).toEqual([[0], [3]]);
  });

  it('clicar no passo atual ou em um ainda não alcançado não faz nada', async () => {
    const user = userEvent.setup();
    const onStepClick = vi.fn();
    render(<Stepper steps={steps} current={2} reached={2} onStepClick={onStepClick} />);
    const list = items();
    await user.click(within(list[2] as HTMLElement).getByText('Fases'));
    await user.click(within(list[4] as HTMLElement).getByText('Revisão'));
    expect(onStepClick).not.toHaveBeenCalled();
  });

  it('pelo teclado: Tab passa só pelos passos clicáveis e Enter volta ao passo', async () => {
    const user = userEvent.setup();
    const onStepClick = vi.fn();
    render(<Stepper steps={steps} current={2} reached={2} onStepClick={onStepClick} />);
    await user.tab();
    expect(screen.getByRole('button', { name: /Jogo/ })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: /Formato/ })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onStepClick).toHaveBeenCalledWith(1);
    await user.tab();
    expect(document.body).toHaveFocus();
  });

  it('o botão do passo explica para leitor de tela que dá para voltar', () => {
    render(<Stepper steps={steps} current={2} onStepClick={() => {}} />);
    expect(screen.getByRole('button', { name: /Jogo.*concluído, voltar a este passo/ })).toHaveClass('min-h-11');
  });

  it('sem onStepClick nenhum passo é clicável', () => {
    render(<Stepper steps={steps} current={3} reached={4} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('a descrição dos passos só aparece na orientação vertical', () => {
    const { rerender } = render(<Stepper steps={steps} current={0} />);
    expect(screen.queryByText('Squads de 4')).not.toBeInTheDocument();
    expect(screen.getByRole('list')).not.toHaveClass('flex-col');
    rerender(<Stepper steps={steps} current={0} orientation="vertical" />);
    expect(screen.getByText('Squads de 4')).toBeInTheDocument();
    expect(screen.getByRole('list')).toHaveClass('flex-col');
  });

  it.each(['horizontal', 'vertical'] as const)('não tem violações de acessibilidade (%s)', async (orientation) => {
    render(<Stepper steps={steps} current={2} reached={3} onStepClick={() => {}} orientation={orientation} />);
    await expectNoA11yViolations();
  });
});
