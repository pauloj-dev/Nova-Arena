import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { expectNoA11yViolations } from '../test/axe';
import { ToastProvider, useToast, type ToastInput } from './Toast';

function Triggers({ custom }: { custom?: ToastInput }) {
  const { toast, success, error } = useToast();
  return (
    <>
      <button type="button" onClick={() => success('Inscrição confirmada', 'O squad está na Copa Booyah.')}>
        sucesso
      </button>
      <button type="button" onClick={() => error('Não deu para enviar o resultado')}>
        erro
      </button>
      <button type="button" onClick={() => toast(custom ?? { title: 'Check-in abre em 15 minutos' })}>
        info
      </button>
    </>
  );
}

function setup(custom?: ToastInput) {
  render(
    <ToastProvider>
      <Triggers custom={custom} />
    </ToastProvider>,
  );
  return screen.getByRole('status');
}

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a região de avisos existe desde o início, vazia, com aria-live="polite"', () => {
    const region = setup();
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toBeEmptyDOMElement();
  });

  it('o aviso aparece dentro da região aria-live, sem tirar o foco de onde estava', () => {
    const region = setup();
    const trigger = screen.getByRole('button', { name: 'sucesso' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(within(region).getByText('Inscrição confirmada')).toBeInTheDocument();
    expect(within(region).getByText('O squad está na Copa Booyah.')).toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('some sozinho depois de 5 segundos', () => {
    const region = setup();
    fireEvent.click(screen.getByRole('button', { name: 'sucesso' }));
    advance(4999);
    expect(within(region).getByText('Inscrição confirmada')).toBeInTheDocument();
    advance(1);
    expect(within(region).queryByText('Inscrição confirmada')).not.toBeInTheDocument();
    expect(region).toBeEmptyDOMElement();
  });

  it('aviso de erro fica mais tempo (8 segundos)', () => {
    const region = setup();
    fireEvent.click(screen.getByRole('button', { name: 'erro' }));
    advance(5000);
    expect(within(region).getByText('Não deu para enviar o resultado')).toBeInTheDocument();
    advance(3000);
    expect(within(region).queryByText('Não deu para enviar o resultado')).not.toBeInTheDocument();
  });

  it('duration: 0 fica até a pessoa fechar', () => {
    const region = setup({ title: 'Senha da sala copiada', duration: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'info' }));
    advance(60_000);
    expect(within(region).getByText('Senha da sala copiada')).toBeInTheDocument();
    fireEvent.click(within(region).getByRole('button', { name: 'Fechar aviso' }));
    expect(region).toBeEmptyDOMElement();
  });

  it('respeita a duração informada', () => {
    const region = setup({ title: 'Resultado salvo', duration: 1000 });
    fireEvent.click(screen.getByRole('button', { name: 'info' }));
    advance(1000);
    expect(region).toBeEmptyDOMElement();
  });

  it('cada tom tem cor e ícone próprios (o ícone é decorativo)', () => {
    const region = setup();
    fireEvent.click(screen.getByRole('button', { name: 'sucesso' }));
    fireEvent.click(screen.getByRole('button', { name: 'erro' }));
    fireEvent.click(screen.getByRole('button', { name: 'info' }));
    const card = (text: string) => within(region).getByText(text).closest('.shadow-md');
    expect(card('Inscrição confirmada')).toHaveClass('bg-primary-soft', 'text-primary-soft-text');
    expect(card('Não deu para enviar o resultado')).toHaveClass('bg-danger-soft', 'text-danger-soft-text');
    expect(card('Check-in abre em 15 minutos')).toHaveClass('bg-surface', 'text-text');
    for (const icon of region.querySelectorAll('svg')) expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('mostra no máximo 4 avisos: o mais antigo sai', () => {
    const region = setup();
    fireEvent.click(screen.getByRole('button', { name: 'sucesso' }));
    for (let i = 0; i < 4; i += 1) fireEvent.click(screen.getByRole('button', { name: 'info' }));
    expect(within(region).getAllByRole('button', { name: 'Fechar aviso' })).toHaveLength(4);
    expect(within(region).queryByText('Inscrição confirmada')).not.toBeInTheDocument();
  });

  it('fechar um aviso não mexe nos outros', () => {
    const region = setup();
    fireEvent.click(screen.getByRole('button', { name: 'sucesso' }));
    fireEvent.click(screen.getByRole('button', { name: 'erro' }));
    const [first] = within(region).getAllByRole('button', { name: 'Fechar aviso' });
    fireEvent.click(first as HTMLElement);
    expect(within(region).queryByText('Inscrição confirmada')).not.toBeInTheDocument();
    expect(within(region).getByText('Não deu para enviar o resultado')).toBeInTheDocument();
  });

  it('useToast fora do provider avisa o que está faltando', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Triggers />)).toThrow('useToast precisa estar dentro de <ToastProvider>.');
  });

  it('não tem violações de acessibilidade', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'sucesso' }));
    fireEvent.click(screen.getByRole('button', { name: 'erro' }));
    vi.useRealTimers();
    await expectNoA11yViolations();
  });
});
