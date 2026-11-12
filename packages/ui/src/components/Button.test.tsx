import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoA11yViolations } from '../test/axe';
import { Button, type ButtonVariant } from './Button';

describe('Button', () => {
  it('é um botão do tipo "button" por padrão e dispara o clique', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Inscrever squad</Button>);
    const button = screen.getByRole('button', { name: 'Inscrever squad' });
    expect(button).toHaveAttribute('type', 'button');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('aceita type="submit"', () => {
    render(<Button type="submit">Salvar</Button>);
    expect(screen.getByRole('button', { name: 'Salvar' })).toHaveAttribute('type', 'submit');
  });

  it('recebe foco com Tab e é acionado por Enter e por Espaço', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Confirmar</Button>);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Confirmar' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('loading desabilita, marca aria-busy e troca o ícone pelo indicador', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick} iconLeft={<span data-testid="icone-esquerda" />} iconRight={<span data-testid="icone-direita" />}>
        Enviando
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Enviando' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByTestId('icone-esquerda')).not.toBeInTheDocument();
    expect(screen.queryByTestId('icone-direita')).not.toBeInTheDocument();
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('sem loading não tem aria-busy e mostra os ícones', () => {
    render(
      <Button iconLeft={<span data-testid="icone-esquerda" />} iconRight={<span data-testid="icone-direita" />}>
        Criar campeonato
      </Button>,
    );
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-busy');
    expect(screen.getByTestId('icone-esquerda')).toBeInTheDocument();
    expect(screen.getByTestId('icone-direita')).toBeInTheDocument();
  });

  it('disabled não dispara o clique nem recebe foco', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Inscrever squad
      </Button>,
    );
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    await user.click(button);
    await user.tab();
    expect(onClick).not.toHaveBeenCalled();
    expect(button).not.toHaveFocus();
  });

  it('asChild renderiza o filho (um link) com o visual de botão, sem <button> em volta', () => {
    render(
      <Button asChild variant="secondary" size="lg">
        <a href="/campeonatos/copa-booyah">Ver campeonato</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Ver campeonato' });
    expect(link).toHaveAttribute('href', '/campeonatos/copa-booyah');
    expect(link).toHaveClass('inline-flex', 'bg-surface', 'min-h-12');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it.each<[ButtonVariant, string]>([
    ['primary', 'bg-accent'],
    ['secondary', 'bg-surface'],
    ['ghost', 'bg-transparent'],
    ['danger', 'bg-danger'],
    ['gold', 'bg-gold-gradient'],
  ])('variante %s usa a classe %s', (variant, className) => {
    render(<Button variant={variant}>Ação</Button>);
    expect(screen.getByRole('button')).toHaveClass(className);
  });

  it('tem área de toque de 44 px no celular em todos os tamanhos', () => {
    render(
      <>
        <Button size="sm">Pequeno</Button>
        <Button size="md">Médio</Button>
        <Button size="lg">Grande</Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Pequeno' })).toHaveClass('min-h-11');
    expect(screen.getByRole('button', { name: 'Médio' })).toHaveClass('min-h-11');
    expect(screen.getByRole('button', { name: 'Grande' })).toHaveClass('min-h-12');
  });

  it('fullWidth ocupa a largura toda e className é somada', () => {
    render(
      <Button fullWidth className="mt-4">
        Confirmar inscrição
      </Button>,
    );
    expect(screen.getByRole('button')).toHaveClass('w-full', 'mt-4');
  });

  it('não tem violações de acessibilidade', async () => {
    render(
      <>
        <Button>Inscrever squad</Button>
        <Button variant="secondary" disabled>
          Ver regulamento
        </Button>
        <Button variant="danger" loading>
          Cancelando
        </Button>
        <Button asChild variant="ghost">
          <a href="/regulamento">Regulamento</a>
        </Button>
      </>,
    );
    await expectNoA11yViolations();
  });
});
