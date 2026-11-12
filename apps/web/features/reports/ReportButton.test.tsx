import { ToastProvider } from '@nova/ui';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { ReportButton } from './ReportButton';

// Testes com muitas interações: folga para quando a máquina está ocupada (CI ou execuções em paralelo).
vi.setConfig({ testTimeout: 30_000 });

const router = { push: vi.fn() };
const state = vi.hoisted(() => ({
  user: { id: 'u_bianca' } as { id: string } | null,
  create: { mutate: (() => undefined) as (input: unknown, opts?: unknown) => void, isPending: false },
  upload: (() => Promise.resolve('')) as (file: File, purpose: string) => Promise<string>,
}));

vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/u/Lucas' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/shared/session/useSession', () => ({ useSession: () => ({ user: state.user, isLoading: false }) }));
vi.mock('@/shared/api/hooks/reports', () => ({ useCreateReport: () => state.create }));
vi.mock('@/shared/api/upload', () => ({
  uploadImage: (file: File, purpose: string) => state.upload(file, purpose),
  uploadErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'Não foi possível enviar a imagem. Tente de novo.'),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

type MutateOptions = { onSuccess?: () => void; onError?: (e: unknown) => void };
const png = (name: string) => new File(['x'], name, { type: 'image/png' });

function renderButton(ui: ReactNode = <ReportButton targetType="USER" targetId="u_lucas" targetLabel="Lucas" />) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

async function openForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Denunciar Lucas' }));
  return screen.findByRole('dialog', { name: 'Denunciar Lucas' });
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  state.user = { id: 'u_bianca' };
  state.create = { mutate: vi.fn(), isPending: false };
  let n = 0;
  state.upload = vi.fn(() => {
    n += 1;
    return Promise.resolve(`data:image/jpeg;base64,IMG${n}`);
  });
  router.push.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe('ReportButton', () => {
  it('variantes: botão com texto e só ícone, as duas com nome acessível', () => {
    const { unmount } = renderButton();
    expect(screen.getByRole('button', { name: 'Denunciar Lucas' })).toHaveTextContent('Denunciar');
    unmount();
    renderButton(<ReportButton targetType="TEAM" targetId="t_alfa" targetLabel="Squad Alfa" variant="icon" />);
    const icon = screen.getByRole('button', { name: 'Denunciar Squad Alfa' });
    expect(icon).toHaveTextContent('');
  });

  it('visitante é levado ao login e volta para a mesma página', async () => {
    state.user = null;
    const user = userEvent.setup();
    renderButton();
    await user.click(screen.getByRole('button', { name: 'Denunciar Lucas' }));
    expect(router.push).toHaveBeenCalledWith('/entrar?next=%2Fu%2FLucas');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('valida motivo e descrição antes de chamar a API', async () => {
    const user = userEvent.setup();
    renderButton();
    const dialog = await openForm(user);
    await user.click(within(dialog).getByRole('button', { name: 'Enviar denúncia' }));
    expect(await within(dialog).findByText('Escolha um motivo')).toBeInTheDocument();
    expect(within(dialog).getByText('Conte o que aconteceu (pelo menos 10 caracteres)')).toBeInTheDocument();
    expect(state.create.mutate).not.toHaveBeenCalled();
  });

  it('lista os motivos do contrato', async () => {
    const user = userEvent.setup();
    renderButton();
    const dialog = await openForm(user);
    const options = within(within(dialog).getByLabelText(/Motivo/)).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Escolha o motivo', 'Trapaça (hack, emulador, conta de outra pessoa)', 'Resultado falso', 'Ofensa ou assédio', 'Nome, tag ou imagem ofensiva', 'Se passa por outra pessoa', 'Outro motivo']);
  });

  it('anexa até 3 imagens, mostra miniatura e deixa remover', async () => {
    const user = userEvent.setup();
    renderButton();
    const dialog = await openForm(user);
    const input = within(dialog).getByLabelText(/Anexos \(opcional\)/);

    await user.upload(input, [png('a.png'), png('b.png')]);
    expect(await within(dialog).findByRole('img', { name: 'Anexo 2' })).toBeInTheDocument();
    expect(state.upload).toHaveBeenCalledWith(expect.any(File), 'report');

    // Só cabem mais 1: o excedente é recusado com aviso.
    await user.upload(within(dialog).getByLabelText(/Anexos \(opcional\)/), [png('c.png'), png('d.png')]);
    expect(await within(dialog).findByRole('img', { name: 'Anexo 3' })).toBeInTheDocument();
    expect(within(dialog).getByText('Só é possível anexar até 3 imagens.')).toBeInTheDocument();
    expect(state.upload).toHaveBeenCalledTimes(3);
    // Cheio: o botão de anexar some.
    expect(within(dialog).queryByLabelText(/Anexos \(opcional\)/)).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Remover anexo 1' }));
    expect(within(dialog).getAllByRole('img')).toHaveLength(2);
    expect(within(dialog).getByLabelText(/Anexos \(opcional\)/)).toBeInTheDocument();
  });

  it('duas imagens iguais (mesma URL): remover uma não leva a outra junto', async () => {
    state.upload = vi.fn(() => Promise.resolve('data:image/jpeg;base64,IGUAL'));
    const user = userEvent.setup();
    renderButton();
    const dialog = await openForm(user);
    await user.upload(within(dialog).getByLabelText(/Anexos \(opcional\)/), [png('a.png'), png('a-copia.png')]);
    expect(await within(dialog).findByRole('img', { name: 'Anexo 2' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Remover anexo 2' }));
    expect(within(dialog).getAllByRole('img')).toHaveLength(1);
  });

  it('falha no envio da imagem aparece no formulário e não anexa', async () => {
    state.upload = vi.fn(() => Promise.reject(new Error('A imagem pode ter no máximo 5 MB.')));
    const user = userEvent.setup();
    renderButton();
    const dialog = await openForm(user);
    await user.upload(within(dialog).getByLabelText(/Anexos \(opcional\)/), png('grande.png'));
    expect(await within(dialog).findByText('A imagem pode ter no máximo 5 MB.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('img')).not.toBeInTheDocument();
  });

  it('envia alvo, motivo, descrição e anexos; depois explica o que acontece', async () => {
    const user = userEvent.setup();
    renderButton();
    const dialog = await openForm(user);
    await user.selectOptions(within(dialog).getByLabelText(/Motivo/), 'HARASSMENT');
    await user.type(within(dialog).getByLabelText(/O que aconteceu/), 'Xingou meu squad no chat da partida.');
    await user.upload(within(dialog).getByLabelText(/Anexos \(opcional\)/), png('chat.png'));
    await within(dialog).findByRole('img', { name: 'Anexo 1' });
    await user.click(within(dialog).getByRole('button', { name: 'Enviar denúncia' }));

    await waitFor(() => expect(state.create.mutate).toHaveBeenCalledTimes(1));
    const [input, options] = vi.mocked(state.create.mutate).mock.calls[0] as [unknown, MutateOptions];
    expect(input).toEqual({ targetType: 'USER', targetId: 'u_lucas', reason: 'HARASSMENT', description: 'Xingou meu squad no chat da partida.', evidenceUrls: ['data:image/jpeg;base64,IMG1'] });

    options.onSuccess?.();
    const done = await screen.findByRole('dialog', { name: 'Denúncia enviada' });
    expect(within(done).getByText(/Recebemos sua denúncia sobre Lucas/)).toBeInTheDocument();
    expect(within(done).getByText(/A moderação da Nova Arena analisa/)).toBeInTheDocument();
    expect(within(done).getByRole('link', { name: 'Ver minhas denúncias' })).toHaveAttribute('href', '/minha-conta/denuncias');
    // Aviso (toast) de sucesso.
    expect(screen.getAllByText('Denúncia enviada').length).toBeGreaterThan(1);

    await user.click(within(done).getByRole('button', { name: 'Entendi' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('erro da API: mostra a mensagem e mantém o formulário aberto', async () => {
    const user = userEvent.setup();
    renderButton();
    const dialog = await openForm(user);
    await user.selectOptions(within(dialog).getByLabelText(/Motivo/), 'OTHER');
    await user.type(within(dialog).getByLabelText(/O que aconteceu/), 'Texto com mais de dez caracteres.');
    await user.click(within(dialog).getByRole('button', { name: 'Enviar denúncia' }));
    await waitFor(() => expect(state.create.mutate).toHaveBeenCalled());
    const [, options] = vi.mocked(state.create.mutate).mock.calls[0] as [unknown, MutateOptions];
    options.onError?.(new ApiError({ type: 'about:blank', title: 'Você já tem denúncias em aberto sobre isto.', status: 409, code: 'REPORT_LIMIT' }));
    expect(await screen.findByText('Você já tem denúncias em aberto sobre isto.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Denunciar Lucas' })).toBeInTheDocument();
  });
});
