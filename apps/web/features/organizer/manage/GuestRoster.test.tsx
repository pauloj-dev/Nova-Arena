/** Inscrito avulso e elenco sem conta (RN-18): o formulário da organização e o diálogo do elenco do squad sem conta. */
import type { OrganizerTournamentDetail, Registration } from '@nova/schemas';
import { ToastProvider } from '@nova/ui';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { AddRegistrationDialog } from './AddRegistrationDialog';
import { GuestRosterDialog } from './GuestRosterDialog';

vi.setConfig({ testTimeout: 30_000 });

type Opts = { onSuccess?: (v: unknown) => void; onError?: (e: unknown) => void };
const mutation = () => ({ mutate: vi.fn<(v: unknown, o?: Opts) => void>(), isPending: false, variables: undefined });
const state = vi.hoisted(() => ({
  manual: null as unknown as ReturnType<typeof mutation>,
  add: null as unknown as ReturnType<typeof mutation>,
  update: null as unknown as ReturnType<typeof mutation>,
  remove: null as unknown as ReturnType<typeof mutation>,
}));

vi.mock('@/shared/api/hooks/organizer', () => ({
  useAddManualRegistration: () => state.manual,
  useAddGuest: () => state.add,
  useUpdateGuest: () => state.update,
  useRemoveGuest: () => state.remove,
}));

const FF_4X4 = { teamSize: 4, maxSubs: 1 };
const wrap = (ui: ReactNode) => render(<ToastProvider>{ui}</ToastProvider>);
const guest = (id: string, name: string, extra: Partial<Registration['guests'][number]> = {}) => ({ id, name, gameId: null, isSub: false, ...extra });
const registration = (guests: Registration['guests']): Registration => ({
  id: 'r1',
  tournamentId: 't1',
  displayName: 'Squad Manual',
  tag: null,
  logoUrl: null,
  userId: null,
  teamId: null,
  status: 'CONFIRMED',
  seed: null,
  waitlistPosition: null,
  statusReason: null,
  members: [],
  guests,
  requiredMembers: 4,
  reservedUntil: null,
  createdAt: '2026-11-25T10:00:00.000Z',
});
const tournament = { id: 't1', name: 'Copa', status: 'REGISTRATION_OPEN' } as unknown as OrganizerTournamentDetail;

beforeEach(() => {
  state.manual = mutation();
  state.add = mutation();
  state.update = mutation();
  state.remove = mutation();
});

describe('AddRegistrationDialog (inscrito avulso)', () => {
  const open = (isTeam: boolean) => wrap(<AddRegistrationDialog tournamentId="t1" isTeam={isTeam} roster={isTeam ? FF_4X4 : null} open onOpenChange={() => undefined} />);

  it('jogador avulso: pede o nome e manda só o que foi preenchido', async () => {
    open(false);
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    expect(await screen.findByText('Informe o nome')).toBeTruthy();
    expect(state.manual.mutate).not.toHaveBeenCalled();
    expect(screen.queryByText('Elenco')).toBeNull();

    await userEvent.type(screen.getByLabelText(/Nome do jogador/), ' Zeca ');
    await userEvent.type(screen.getByLabelText(/ID no jogo/), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    expect(state.manual.mutate).toHaveBeenCalledWith({ name: 'Zeca', gameId: '123456' }, expect.anything());
  });

  it('squad do Free Fire 4x4: mostra 4 titulares e 1 reserva e manda o elenco preenchido', async () => {
    open(true);
    const slots = screen.getAllByTestId('roster-slot');
    expect(slots.map((s) => s.querySelector('legend')?.textContent)).toEqual(['Titular 1', 'Titular 2', 'Titular 3', 'Titular 4', 'Reserva 1']);

    await userEvent.type(screen.getByLabelText(/Nome do squad/), 'Squad Manual');
    await userEvent.type(screen.getByLabelText('Tag'), 'man');
    await userEvent.type(within(slots[0] as HTMLElement).getByLabelText('Nome'), 'Ana');
    await userEvent.type(within(slots[0] as HTMLElement).getByLabelText('ID no jogo'), '1001');
    await userEvent.type(within(slots[1] as HTMLElement).getByLabelText('Nome'), 'Bia');
    await userEvent.type(within(slots[4] as HTMLElement).getByLabelText('Nome'), 'Banco');
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    expect(state.manual.mutate).toHaveBeenCalledWith({ name: 'Squad Manual', tag: 'man', members: [{ name: 'Ana', gameId: '1001' }, { name: 'Bia' }, { name: 'Banco', isSub: true }] }, expect.anything());
  });

  it('avisa do ID sem nome e do jogador repetido antes de enviar; mostra o erro de nome da API no campo', async () => {
    open(true);
    const slots = screen.getAllByTestId('roster-slot');
    await userEvent.type(screen.getByLabelText(/Nome do squad/), 'Squad Manual');
    await userEvent.type(within(slots[0] as HTMLElement).getByLabelText('ID no jogo'), '1001');
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    expect(await screen.findByText('Há um ID no jogo sem o nome do jogador. Preencha o nome ou apague o ID.')).toBeTruthy();

    await userEvent.type(within(slots[0] as HTMLElement).getByLabelText('Nome'), 'Ana');
    await userEvent.type(within(slots[1] as HTMLElement).getByLabelText('Nome'), 'ana');
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    expect(await screen.findByText('O jogador "ana" aparece duas vezes no elenco.')).toBeTruthy();
    expect(state.manual.mutate).not.toHaveBeenCalled();

    await userEvent.clear(within(slots[1] as HTMLElement).getByLabelText('Nome'));
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    const message = 'Já existe um inscrito chamado "Squad Manual" neste campeonato.';
    state.manual.mutate.mock.calls[0]?.[1]?.onError?.(new ApiError({ type: 'about:blank', title: message, status: 409, detail: message, code: 'NAME_TAKEN', errors: { name: message } }));
    expect(await screen.findByText(message)).toBeTruthy();
  });
});

describe('GuestRosterDialog (elenco do squad sem conta)', () => {
  const open = (guests: Registration['guests']) => wrap(<GuestRosterDialog tournament={tournament} registration={registration(guests)} roster={FF_4X4} onClose={() => undefined} />);

  it('elenco vazio: coloca um jogador com nome e ID no jogo', async () => {
    open([]);
    expect(screen.getByText('Nenhum jogador no elenco ainda.')).toBeTruthy();
    expect(screen.getByText('0 de 4 titulares · 0 de 1 reserva')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Colocar no elenco' }));
    expect(await screen.findByText('Informe o nome do jogador.')).toBeTruthy();
    await userEvent.type(screen.getByLabelText(/Nome do jogador/), ' Kaue ');
    await userEvent.type(screen.getByLabelText(/ID no jogo/), '555');
    await userEvent.click(screen.getByRole('button', { name: 'Colocar no elenco' }));
    expect(state.add.mutate).toHaveBeenCalledWith({ registrationId: 'r1', input: { name: 'Kaue', gameId: '555', isSub: false } }, expect.anything());
  });

  it('titulares completos: o próximo entra como reserva; elenco completo esconde o formulário', async () => {
    const starters = [guest('g1', 'A'), guest('g2', 'B'), guest('g3', 'C'), guest('g4', 'D', { gameId: '44' })];
    const { unmount } = open(starters);
    expect(screen.getByText('4 de 4 titulares · 0 de 1 reserva')).toBeTruthy();
    expect(screen.getByText('ID 44')).toBeTruthy();
    expect(screen.getByText('Os titulares já estão completos: o próximo jogador entra como reserva.')).toBeTruthy();
    await userEvent.type(screen.getByLabelText(/Nome do jogador/), 'Banco');
    await userEvent.click(screen.getByRole('button', { name: 'Colocar no elenco' }));
    expect(state.add.mutate).toHaveBeenCalledWith({ registrationId: 'r1', input: { name: 'Banco', isSub: true } }, expect.anything());
    unmount();

    open([...starters, guest('g5', 'Banco', { isSub: true })]);
    expect(screen.queryByRole('button', { name: 'Colocar no elenco' })).toBeNull();
    expect(screen.getByText(/O elenco está completo/)).toBeTruthy();
  });

  it('corrige os dados de um jogador e tira outro', async () => {
    open([guest('g1', 'Kaue', { gameId: '555' }), guest('g2', 'Bia')]);
    await userEvent.click(screen.getByRole('button', { name: 'Corrigir os dados de Kaue' }));
    const name = screen.getByLabelText(/Nome do jogador/);
    await userEvent.clear(name);
    await userEvent.type(name, 'Kauê');
    await userEvent.clear(screen.getByLabelText(/ID no jogo/));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(state.update.mutate).toHaveBeenCalledWith({ registrationId: 'r1', guestId: 'g1', input: { name: 'Kauê', gameId: null, isSub: false } }, expect.anything());

    await userEvent.click(screen.getByRole('button', { name: 'Tirar Bia do elenco' }));
    expect(state.remove.mutate).toHaveBeenCalledWith({ registrationId: 'r1', guestId: 'g2' }, expect.anything());
  });

  it('mostra no campo o motivo quando a API recusa (ID que já joga por outro squad)', async () => {
    open([]);
    await userEvent.type(screen.getByLabelText(/Nome do jogador/), 'Ana');
    await userEvent.click(screen.getByRole('button', { name: 'Colocar no elenco' }));
    const message = 'O ID no jogo "1" já está no elenco do Squad Um neste campeonato.';
    state.add.mutate.mock.calls[0]?.[1]?.onError?.(new ApiError({ type: 'about:blank', title: message, status: 409, detail: message, code: 'INVALID_ROSTER' }));
    expect(await screen.findByText(message)).toBeTruthy();
  });
});
