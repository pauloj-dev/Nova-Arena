import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { expectNoA11yViolations } from '../test/axe';
import { Button } from './Button';
import { Input } from './Field';
import { ConfirmDestructive, Drawer, Modal, type DrawerProps, type ModalProps } from './Overlay';

function ModalHarness({ onOpenChange, children, ...props }: Partial<ModalProps> & { children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const change = (o: boolean) => {
    onOpenChange?.(o);
    setOpen(o);
  };
  return (
    <>
      <button type="button" onClick={() => change(true)}>
        Convidar jogador
      </button>
      <a href="/fora">Link fora do modal</a>
      <Modal
        title="Convidar jogador"
        description="O convite vale por 48 horas."
        footer={
          <>
            <Button variant="secondary" onClick={() => change(false)}>
              Cancelar
            </Button>
            <Button>Enviar convite</Button>
          </>
        }
        {...props}
        open={open}
        onOpenChange={change}
      >
        {children ?? <Input label="E-mail ou apelido" />}
      </Modal>
    </>
  );
}

function DrawerHarness({ onOpenChange, ...props }: Partial<DrawerProps>) {
  const [open, setOpen] = useState(false);
  const change = (o: boolean) => {
    onOpenChange?.(o);
    setOpen(o);
  };
  return (
    <>
      <button type="button" onClick={() => change(true)}>
        Abrir filtros
      </button>
      <Drawer title="Filtros" footer={<Button onClick={() => change(false)}>Ver 12 campeonatos</Button>} {...props} open={open} onOpenChange={change}>
        <Input label="Jogo" />
      </Drawer>
    </>
  );
}

function ConfirmHarness({ onConfirm = () => {}, loading }: { onConfirm?: () => void; loading?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Cancelar campeonato
      </button>
      <ConfirmDestructive
        open={open}
        onOpenChange={setOpen}
        title="Cancelar campeonato"
        description="Os 37 squads inscritos serão avisados. Isso não pode ser desfeito."
        confirmText="Copa Booyah de Verão"
        confirmLabel="Cancelar de vez"
        loading={loading}
        onConfirm={() => {
          onConfirm();
          setOpen(false);
        }}
      >
        <p>As quedas já jogadas continuam no histórico.</p>
      </ConfirmDestructive>
    </>
  );
}

describe('Modal', () => {
  it('fechado não renderiza nada', () => {
    render(<ModalHarness />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('aberto é um diálogo com nome (título) e descrição', async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);
    await user.click(screen.getByRole('button', { name: 'Convidar jogador' }));
    const dialog = screen.getByRole('dialog', { name: 'Convidar jogador' });
    expect(dialog).toHaveAccessibleDescription('O convite vale por 48 horas.');
    expect(within(dialog).getByRole('heading', { name: 'Convidar jogador' })).toBeInTheDocument();
    expect(within(dialog).getByLabelText('E-mail ou apelido')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Enviar convite' })).toBeInTheDocument();
  });

  it('sem descrição usa o título como descrição só para leitor de tela', async () => {
    const user = userEvent.setup();
    render(<ModalHarness description={undefined} />);
    await user.click(screen.getByRole('button', { name: 'Convidar jogador' }));
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Convidar jogador');
  });

  it('ao abrir, o foco entra no diálogo e o resto da página sai da árvore de acessibilidade', async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);
    await user.click(screen.getByRole('button', { name: 'Convidar jogador' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(screen.getByText('Link fora do modal').closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.queryByRole('link', { name: 'Link fora do modal' })).not.toBeInTheDocument();
  });

  it('prende o foco: Tab e Shift+Tab dão a volta sem sair do diálogo', async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);
    await user.click(screen.getByRole('button', { name: 'Convidar jogador' }));
    const dialog = screen.getByRole('dialog');
    const visited = new Set<Element>();
    for (let i = 0; i < 12; i += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
      visited.add(document.activeElement as Element);
    }
    expect(visited).toContain(within(dialog).getByRole('button', { name: 'Fechar' }));
    expect(visited).toContain(within(dialog).getByLabelText('E-mail ou apelido'));
    expect(visited).toContain(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(visited).toContain(within(dialog).getByRole('button', { name: 'Enviar convite' }));
    for (let i = 0; i < 6; i += 1) {
      await user.tab({ shift: true });
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it('Esc fecha e devolve o foco ao gatilho', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<ModalHarness onOpenChange={onOpenChange} />);
    const trigger = screen.getByRole('button', { name: 'Convidar jogador' });
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('o botão "Fechar" fecha e devolve o foco ao gatilho', async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);
    const trigger = screen.getByRole('button', { name: 'Convidar jogador' });
    await user.click(trigger);
    const close = screen.getByRole('button', { name: 'Fechar' });
    expect(close).toHaveClass('size-11');
    await user.click(close);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('fechar por uma ação do rodapé também devolve o foco', async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);
    const trigger = screen.getByRole('button', { name: 'Convidar jogador' });
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('a área de conteúdo rola pelo teclado (recebe foco)', async () => {
    const user = userEvent.setup();
    render(
      <ModalHarness footer={undefined}>
        <p>Regulamento completo do campeonato.</p>
      </ModalHarness>,
    );
    await user.click(screen.getByRole('button', { name: 'Convidar jogador' }));
    const body = screen.getByText('Regulamento completo do campeonato.').parentElement;
    expect(body).toHaveClass('overflow-y-auto');
    expect(body).toHaveAttribute('tabindex', '0');
    expect(within(screen.getByRole('dialog')).queryByRole('contentinfo')).not.toBeInTheDocument();
  });

  it.each([
    ['sm', 'md:max-w-sm'],
    ['md', 'md:max-w-lg'],
    ['lg', 'md:max-w-3xl'],
  ] as const)('tamanho %s; tela cheia no celular', async (size, className) => {
    const user = userEvent.setup();
    render(<ModalHarness size={size} />);
    await user.click(screen.getByRole('button', { name: 'Convidar jogador' }));
    expect(screen.getByRole('dialog')).toHaveClass(className, 'inset-0');
  });

  it('não tem violações de acessibilidade', async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);
    await user.click(screen.getByRole('button', { name: 'Convidar jogador' }));
    await expectNoA11yViolations();
  });
});

describe('ConfirmDestructive', () => {
  async function open(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Cancelar campeonato' }));
    const dialog = screen.getByRole('dialog', { name: 'Cancelar campeonato' });
    return {
      dialog,
      confirm: within(dialog).getByRole('button', { name: 'Cancelar de vez' }),
      input: within(dialog).getByRole('textbox', { name: /Para confirmar, digite Copa Booyah de Verão/ }),
    };
  }

  it('mostra o que vai acontecer e o nome que precisa ser digitado', async () => {
    const user = userEvent.setup();
    render(<ConfirmHarness />);
    const { dialog, input } = await open(user);
    expect(dialog).toHaveAccessibleDescription('Os 37 squads inscritos serão avisados. Isso não pode ser desfeito.');
    expect(within(dialog).getByText('As quedas já jogadas continuam no histórico.')).toBeInTheDocument();
    expect(within(dialog).getByText('Copa Booyah de Verão').tagName).toBe('STRONG');
    expect(input).toHaveAttribute('autocomplete', 'off');
  });

  it('o botão começa bloqueado e só libera quando o nome é digitado por inteiro', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmHarness onConfirm={onConfirm} />);
    const { confirm, input } = await open(user);
    expect(confirm).toBeDisabled();
    await user.type(input, 'Copa Booyah');
    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
    await user.type(input, ' de Verão');
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('nome errado mantém o botão bloqueado', async () => {
    const user = userEvent.setup();
    render(<ConfirmHarness />);
    const { confirm, input } = await open(user);
    await user.type(input, 'Copa Booyah de Inverno');
    expect(confirm).toBeDisabled();
  });

  it('ignora maiúsculas e espaços nas pontas', async () => {
    const user = userEvent.setup();
    render(<ConfirmHarness />);
    const { confirm, input } = await open(user);
    await user.type(input, '  copa booyah de verão ');
    expect(confirm).toBeEnabled();
  });

  it('dá para confirmar só pelo teclado', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmHarness onConfirm={onConfirm} />);
    const { input, confirm } = await open(user);
    input.focus();
    await user.keyboard('Copa Booyah de Verão');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Voltar' })).toHaveFocus();
    await user.tab();
    expect(confirm).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('enquanto envia (loading) o botão fica bloqueado e ocupado, mesmo com o nome certo', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmHarness loading onConfirm={onConfirm} />);
    const { confirm, input } = await open(user);
    await user.type(input, 'Copa Booyah de Verão');
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    await user.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it.each([
    ['"Voltar"', async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Voltar' }))],
    ['Esc', async (user: ReturnType<typeof userEvent.setup>) => user.keyboard('{Escape}')],
    ['confirmar', async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Cancelar de vez' }))],
  ])('fechar por %s limpa o nome digitado: ao reabrir, o botão volta bloqueado', async (_name, close) => {
    const user = userEvent.setup();
    render(<ConfirmHarness />);
    const first = await open(user);
    await user.type(first.input, 'Copa Booyah de Verão');
    expect(first.confirm).toBeEnabled();
    await close(user);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const second = await open(user);
    expect(second.input).toHaveValue('');
    expect(second.confirm).toBeDisabled();
  });

  it('não tem violações de acessibilidade', async () => {
    const user = userEvent.setup();
    render(<ConfirmHarness />);
    await open(user);
    await expectNoA11yViolations();
  });
});

describe('Drawer', () => {
  it('fechado não renderiza nada; aberto é um diálogo com o título como nome', async () => {
    const user = userEvent.setup();
    render(<DrawerHarness />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Abrir filtros' }));
    const dialog = screen.getByRole('dialog', { name: 'Filtros' });
    expect(within(dialog).getByLabelText('Jogo')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Ver 12 campeonatos' })).toBeInTheDocument();
  });

  it.each([
    ['left', 'left-0'],
    ['right', 'right-0'],
    ['bottom', 'bottom-0'],
  ] as const)('lado %s', async (side, className) => {
    const user = userEvent.setup();
    render(<DrawerHarness side={side} />);
    await user.click(screen.getByRole('button', { name: 'Abrir filtros' }));
    expect(screen.getByRole('dialog')).toHaveClass(className);
  });

  it('abre do lado direito por padrão', async () => {
    const user = userEvent.setup();
    render(<DrawerHarness />);
    await user.click(screen.getByRole('button', { name: 'Abrir filtros' }));
    expect(screen.getByRole('dialog')).toHaveClass('right-0');
  });

  it('prende o foco dentro do painel', async () => {
    const user = userEvent.setup();
    render(<DrawerHarness />);
    await user.click(screen.getByRole('button', { name: 'Abrir filtros' }));
    const dialog = screen.getByRole('dialog');
    for (let i = 0; i < 8; i += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it('Esc fecha e devolve o foco ao gatilho', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<DrawerHarness onOpenChange={onOpenChange} />);
    const trigger = screen.getByRole('button', { name: 'Abrir filtros' });
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('o botão "Fechar" tem área de toque de 44 px e fecha', async () => {
    const user = userEvent.setup();
    render(<DrawerHarness />);
    await user.click(screen.getByRole('button', { name: 'Abrir filtros' }));
    const close = screen.getByRole('button', { name: 'Fechar' });
    expect(close).toHaveClass('size-11');
    await user.click(close);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('não tem violações de acessibilidade', async () => {
    const user = userEvent.setup();
    render(<DrawerHarness />);
    await user.click(screen.getByRole('button', { name: 'Abrir filtros' }));
    await expectNoA11yViolations();
  });
});
