import type { DiscordLinkStatus } from '@nova/schemas';
import { ToastProvider } from '@nova/ui';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DiscordTab } from './DiscordTab';

vi.setConfig({ testTimeout: 30_000 });

type Opts = { onSuccess?: (v: never) => void; onError?: (e: unknown) => void };
const state = vi.hoisted(() => ({
  query: { isPending: false, error: null as unknown, refetch: () => undefined, data: undefined as DiscordLinkStatus | undefined },
  create: { mutate: (() => undefined) as (v: undefined, o?: Opts) => void, isPending: false },
  test: { mutate: (() => undefined) as (v: undefined, o?: Opts) => void, isPending: false },
  unlink: { mutate: (() => undefined) as (v: undefined, o?: Opts) => void, isPending: false },
  simulate: { mutate: (() => undefined) as (code: string, o?: Opts) => void, isPending: false },
  mocked: true,
}));

vi.mock('@/shared/api/hooks/discord', () => ({
  useDiscordLink: () => state.query,
  useCreateDiscordCode: () => state.create,
  useTestDiscord: () => state.test,
  useUnlinkDiscord: () => state.unlink,
  useSimulateDiscordLink: () => state.simulate,
}));
vi.mock('@/shared/api/mode', () => ({ isModuleMocked: () => state.mocked }));

const base: DiscordLinkStatus = {
  enabled: true,
  installUrl: 'https://discord.com/oauth2/authorize?client_id=1',
  state: 'NONE',
  codeExpiresAt: null,
  guildId: null,
  guildName: null,
  channelId: null,
  linkedAt: null,
  linkedByNickname: null,
  lastAnnouncementAt: null,
  lastError: null,
};

const renderTab = () =>
  render(
    <ToastProvider>
      <DiscordTab tournamentId="t1" />
    </ToastProvider>,
  );

beforeEach(() => {
  state.query = { isPending: false, error: null, refetch: vi.fn(), data: base };
  state.create = { mutate: vi.fn(), isPending: false };
  state.test = { mutate: vi.fn(), isPending: false };
  state.unlink = { mutate: vi.fn(), isPending: false };
  state.simulate = { mutate: vi.fn(), isPending: false };
  state.mocked = true;
});

describe('DiscordTab', () => {
  it('bot desligado no ambiente: explica e não oferece o vínculo', () => {
    state.query.data = { ...base, enabled: false, installUrl: null };
    renderTab();
    expect(screen.getByText('O bot do Discord não está ativo nesta instalação')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Gerar código/ })).not.toBeInTheDocument();
  });

  it('gera o código e mostra o comando pronto; no protótipo, simula o comando', async () => {
    const user = userEvent.setup();
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    state.create.mutate = vi.fn((_v, o) => {
      state.query.data = { ...base, state: 'PENDING', codeExpiresAt: expiresAt };
      o?.onSuccess?.({ code: 'NA-ABCD-EFGH', expiresAt, command: '/nova-arena vincular codigo:NA-ABCD-EFGH' } as never);
    });
    const view = renderTab();
    expect(screen.getByRole('link', { name: /Adicionar o bot ao Discord/ })).toHaveAttribute('href', base.installUrl);
    await user.click(screen.getByRole('button', { name: 'Gerar código de vínculo' }));
    view.rerender(
      <ToastProvider>
        <DiscordTab tournamentId="t1" />
      </ToastProvider>,
    );
    expect(screen.getByLabelText('Comando para o Discord')).toHaveTextContent('/nova-arena vincular codigo:NA-ABCD-EFGH');
    await user.click(screen.getByRole('button', { name: 'Simular o comando no protótipo' }));
    expect(state.simulate.mutate).toHaveBeenCalledWith('NA-ABCD-EFGH', expect.anything());
  });

  it('vinculado: servidor, canal, problema de entrega com ícone e texto, teste e desvincular com confirmação', async () => {
    const user = userEvent.setup();
    state.query.data = { ...base, state: 'ACTIVE', guildId: 'g', guildName: 'Servidor da Liga', channelId: '123', linkedAt: new Date().toISOString(), linkedByNickname: 'Camila', lastError: 'O bot não tem permissão para escrever no canal vinculado.' };
    renderTab();
    expect(screen.getByRole('heading', { name: 'Servidor da Liga' })).toBeInTheDocument();
    expect(screen.getByText('Vinculado')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('O último aviso não chegou.');
    await user.click(screen.getByRole('button', { name: 'Enviar aviso de teste' }));
    expect(state.test.mutate).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Desvincular' }));
    const confirm = screen.getAllByRole('button', { name: 'Desvincular' }).at(-1) as HTMLElement;
    expect(confirm).toBeDisabled();
    await user.type(screen.getByRole('textbox'), 'desvincular');
    await user.click(confirm);
    expect(state.unlink.mutate).toHaveBeenCalled();
  });

  it('erro ao carregar: tentar de novo', async () => {
    const refetch = vi.fn();
    state.query = { isPending: false, error: new TypeError('rede'), refetch, data: undefined };
    renderTab();
    await userEvent.setup().click(screen.getByRole('button', { name: /Tentar novamente/ }));
    expect(refetch).toHaveBeenCalled();
  });
});
