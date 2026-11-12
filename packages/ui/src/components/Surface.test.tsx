import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expectNoA11yViolations } from '../test/axe';
import { Avatar, Card, EmptyState, ErrorState, Progress, Skeleton, Tabs, type TabItem } from './Surface';

const tabs: TabItem[] = [
  { value: 'visao-geral', label: 'Visão geral', content: <p>Seis quedas em Bermuda.</p> },
  { value: 'squads', label: 'Squads', content: <p>37 squads inscritos.</p> },
  { value: 'tabela', label: 'Tabela', content: <p>Tabela de pontos.</p>, disabled: true },
  { value: 'premiacao', label: 'Premiação', content: <p>R$ 5.000 em prêmios.</p> },
];

describe('Card', () => {
  it('renderiza o conteúdo com superfície, borda e padding padrão', () => {
    render(<Card data-testid="card">Copa Booyah de Verão</Card>);
    expect(screen.getByTestId('card')).toHaveTextContent('Copa Booyah de Verão');
    expect(screen.getByTestId('card')).toHaveClass('bg-surface', 'border-border', 'p-4');
  });

  it.each([
    ['none', []],
    ['sm', ['p-3']],
    ['md', ['p-4']],
  ] as const)('padding %s', (padding, classes) => {
    render(<Card data-testid="card" padding={padding} />);
    const card = screen.getByTestId('card');
    for (const c of classes) expect(card).toHaveClass(c);
    if (padding === 'none') expect(card.className).not.toMatch(/\bp-\d/);
  });

  it('interactive destaca no hover e quando o foco está dentro', () => {
    render(<Card data-testid="card" interactive />);
    expect(screen.getByTestId('card')).toHaveClass('hover:shadow-md', 'focus-within:shadow-md');
  });
});

describe('Avatar', () => {
  it.each([
    ['Rafaela Monteiro', 'RM'],
    ['caio de souza ferraz', 'CF'],
    ['Thiago', 'T'],
    ['  Júlia   Paiva ', 'JP'],
    ['', '?'],
  ])('mostra as iniciais de "%s": %s', (name, initials) => {
    const { container } = render(<Avatar name={name} />);
    expect(container).toHaveTextContent(initials);
  });

  it('as iniciais são decorativas (o nome aparece ao lado, em texto)', () => {
    render(<Avatar name="Rafaela Monteiro" />);
    expect(screen.getByText('RM')).toHaveAttribute('aria-hidden', 'true');
  });

  it.each([
    ['sm', 'size-7'],
    ['md', 'size-9'],
    ['lg', 'size-12'],
    ['xl', 'size-20'],
  ] as const)('tamanho %s', (size, className) => {
    const { container } = render(<Avatar name="Rafaela Monteiro" size={size} />);
    expect(container.firstElementChild).toHaveClass(className);
  });

  it('enquanto a imagem não carrega (ou se falhar), cai nas iniciais', async () => {
    render(<Avatar name="Caio Ferraz" src="/nao-existe.png" />);
    expect(await screen.findByText('CF')).toBeInTheDocument();
  });
});

describe('Tabs', () => {
  it('monta tablist com nome, abas e o painel da primeira aba', () => {
    render(<Tabs items={tabs} label="Seções do campeonato" />);
    expect(screen.getByRole('tablist', { name: 'Seções do campeonato' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByRole('tab', { name: 'Visão geral' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Visão geral' })).toHaveTextContent('Seis quedas em Bermuda.');
    expect(screen.queryByText('37 squads inscritos.')).not.toBeInTheDocument();
  });

  it('as setas mudam de aba, pulam a desabilitada e dão a volta', async () => {
    const user = userEvent.setup();
    render(<Tabs items={tabs} label="Seções do campeonato" />);
    await user.tab();
    expect(screen.getByRole('tab', { name: 'Visão geral' })).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Squads' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Squads' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('37 squads inscritos.');

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Premiação' })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('R$ 5.000 em prêmios.');

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Visão geral' })).toHaveFocus();

    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Premiação' })).toHaveFocus();
  });

  it('Home e End vão para a primeira e a última aba', async () => {
    const user = userEvent.setup();
    render(<Tabs items={tabs} label="Seções do campeonato" defaultValue="squads" />);
    await user.tab();
    expect(screen.getByRole('tab', { name: 'Squads' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Premiação' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Visão geral' })).toHaveAttribute('aria-selected', 'true');
  });

  it('Tab sai da lista de abas e entra no painel, que mostra o foco', async () => {
    const user = userEvent.setup();
    render(<Tabs items={tabs} label="Seções do campeonato" />);
    await user.tab();
    await user.tab();
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveFocus();
    expect(panel.className).not.toMatch(/outline-none/);
  });

  it('aba desabilitada não abre com clique', async () => {
    const user = userEvent.setup();
    render(<Tabs items={tabs} label="Seções do campeonato" />);
    const disabled = screen.getByRole('tab', { name: 'Tabela' });
    expect(disabled).toBeDisabled();
    await user.click(disabled);
    expect(screen.getByRole('tab', { name: 'Visão geral' })).toHaveAttribute('aria-selected', 'true');
  });

  it('controlada: avisa por onValueChange e segue o value', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    function Controlled() {
      const [value, setValue] = useState('squads');
      return (
        <Tabs
          items={tabs}
          label="Seções do campeonato"
          value={value}
          onValueChange={(v) => {
            onValueChange(v);
            setValue(v);
          }}
        />
      );
    }
    render(<Controlled />);
    expect(screen.getByRole('tab', { name: 'Squads' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('tab', { name: 'Premiação' }));
    expect(onValueChange).toHaveBeenCalledWith('premiacao');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('R$ 5.000 em prêmios.');
  });

  it('abas têm área de toque de 44 px', () => {
    render(<Tabs items={tabs} label="Seções do campeonato" />);
    for (const tab of screen.getAllByRole('tab')) expect(tab).toHaveClass('min-h-11');
  });
});

describe('Skeleton', () => {
  it('fica escondido de leitores de tela e aceita o formato do conteúdo', () => {
    render(<Skeleton data-testid="skeleton" className="h-6 w-3/4" />);
    const skeleton = screen.getByTestId('skeleton');
    expect(skeleton).toHaveAttribute('aria-hidden', 'true');
    expect(skeleton).toHaveClass('animate-skeleton', 'h-6', 'w-3/4');
  });
});

describe('EmptyState', () => {
  it('mostra título, descrição, ícone decorativo e a ação sugerida', async () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        icon={<svg data-testid="icone" />}
        title="Nenhum campeonato de Free Fire aberto"
        description="Siga o jogo para saber quando abrir uma nova inscrição."
        action={
          <button type="button" onClick={onClick}>
            Seguir Free Fire
          </button>
        }
      />,
    );
    expect(screen.getByRole('heading', { name: 'Nenhum campeonato de Free Fire aberto' })).toBeInTheDocument();
    expect(screen.getByText('Siga o jogo para saber quando abrir uma nova inscrição.')).toBeInTheDocument();
    expect(screen.getByTestId('icone').parentElement).toHaveAttribute('aria-hidden', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Seguir Free Fire' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('só com título não cria ícone, descrição nem ação', () => {
    const { container } = render(<EmptyState title="Nenhuma disputa aberta" />);
    expect(container.querySelector('p')).not.toBeInTheDocument();
    expect(container.querySelector('[aria-hidden]')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('ErrorState', () => {
  it('é um alerta com título padrão em linguagem humana', () => {
    render(<ErrorState />);
    const alert = screen.getByRole('alert');
    expect(within(alert).getByRole('heading', { name: 'Não foi possível carregar' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('"Tentar novamente" chama onRetry, por clique e por teclado', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ErrorState title="Não foi possível carregar a tabela" description="A conexão caiu." onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('A conexão caiu.');
    const retry = screen.getByRole('button', { name: 'Tentar novamente' });
    expect(retry).toHaveClass('min-h-11');
    await user.click(retry);
    await user.keyboard('{Enter}');
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('aceita conteúdo extra', () => {
    render(
      <ErrorState>
        <a href="/campeonatos">Ver campeonatos abertos</a>
      </ErrorState>,
    );
    expect(within(screen.getByRole('alert')).getByRole('link', { name: 'Ver campeonatos abertos' })).toBeInTheDocument();
  });
});

describe('Progress', () => {
  it('expõe valor, mínimo e máximo, e mostra o número em texto', () => {
    render(<Progress value={37} max={48} label="Vagas preenchidas" />);
    const bar = screen.getByRole('progressbar', { name: 'Vagas preenchidas' });
    expect(bar).toHaveAttribute('aria-valuenow', '37');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '48');
    expect(bar.firstElementChild).toHaveStyle({ width: '77%' });
    expect(screen.getByText('37/48')).toBeInTheDocument();
  });

  it('acima do total a barra para em 100% e o valor acessível não passa do máximo', () => {
    render(<Progress value={53} max={48} label="Inscrições" />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '48');
    expect(bar.firstElementChild).toHaveStyle({ width: '100%' });
    expect(screen.getByText('53/48')).toBeInTheDocument();
  });

  it('com máximo zero fica em 0% sem dividir por zero', () => {
    render(<Progress value={0} max={0} label="Vagas" />);
    expect(screen.getByRole('progressbar').firstElementChild).toHaveStyle({ width: '0%' });
  });
});

describe('acessibilidade (axe)', () => {
  it('Card, Avatar, Skeleton, EmptyState, ErrorState e Progress não têm violações', async () => {
    render(
      <main>
        <h1>Campeonatos</h1>
        <h2>Abertos</h2>
        <Card interactive>
          <div className="flex items-center gap-2">
            <Avatar name="Rafaela Monteiro" />
            <span>Rafaela Monteiro</span>
          </div>
          <Progress value={37} max={48} label="Vagas preenchidas" />
          <Skeleton className="h-4 w-full" />
        </Card>
        <EmptyState icon={<svg />} title="Nenhum campeonato aberto" description="Siga o jogo." action={<button type="button">Seguir</button>} />
        <ErrorState description="A conexão caiu." onRetry={() => {}} />
      </main>,
    );
    await expectNoA11yViolations();
  });

  it('Tabs não tem violações', async () => {
    render(<Tabs items={tabs} label="Seções do campeonato" />);
    await expectNoA11yViolations();
  });
});
