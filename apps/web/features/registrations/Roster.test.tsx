/** Telas do elenco do squad: diálogo da organização, cartão do capitão/membro e convite que já escala no campeonato. */
import type { AcceptTeamInviteResult, OrganizerTournamentDetail, Registration, Team, TeamInvitePreview, Tournament } from '@nova/schemas';
import { ToastProvider } from '@nova/ui';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RosterDialog } from '@/features/organizer/manage/RosterDialog';
import { TeamInvitePage } from '@/features/teams/TeamInvitePage';
import { MyRegistrationCard } from './MyRegistrationCard';

vi.setConfig({ testTimeout: 30_000 });

type Opts = { onSuccess?: (v: never) => void; onError?: (e: unknown) => void };
const mutation = () => ({ mutate: vi.fn((_v: unknown, _o?: Opts): void => undefined), isPending: false, variables: undefined });
const state = vi.hoisted(() => ({
  add: null as unknown as ReturnType<typeof mutation>,
  remove: null as unknown as ReturnType<typeof mutation>,
  move: null as unknown as ReturnType<typeof mutation>,
  accept: null as unknown as ReturnType<typeof mutation>,
  team: undefined as Team | undefined,
  preview: undefined as TeamInvitePreview | undefined,
  user: { id: 'u_cap' } as { id: string } | null,
}));

vi.mock('@/shared/api/hooks/registrations', () => ({
  useAddRosterMember: () => state.add,
  useRemoveRosterMember: () => state.remove,
  useMoveRosterMember: () => state.move,
  useConfirmRegistration: () => mutation(),
  useDeclineRegistration: () => mutation(),
  useCancelRegistration: () => mutation(),
}));
vi.mock('@/shared/api/hooks/games', () => ({
  useGame: () => ({ isPending: false, data: { modes: [{ id: 'm1', teamSize: 2, maxSubs: 1 }] } }),
}));
vi.mock('@/shared/api/hooks/teams', () => ({
  useTeam: () => ({ isPending: false, isError: false, data: state.team }),
  useTeamInvitePreview: () => ({ isPending: false, isError: false, data: state.preview }),
  useAcceptTeamInvite: () => state.accept,
  useDeclineTeamInvite: () => mutation(),
}));
vi.mock('@/shared/session/useSession', () => ({ useSession: () => ({ user: state.user, isLoading: false }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/' }));

const member = (userId: string, nickname: string, extra: Partial<Registration['members'][number]> = {}) => ({ userId, nickname, avatarUrl: null, isCaptain: false, isSub: false, confirmedAt: '2026-11-20T10:00:00.000Z', hasGameAccount: true, ...extra });
const registration = (over: Partial<Registration> = {}): Registration => ({
  id: 'r1',
  tournamentId: 't1',
  displayName: 'Squad Alfa',
  tag: 'ALFA',
  logoUrl: null,
  userId: null,
  teamId: 'team1',
  status: 'CONFIRMED',
  seed: null,
  waitlistPosition: null,
  statusReason: null,
  members: [member('u_cap', 'Capi', { isCaptain: true }), member('u_b', 'Beto')],
  requiredMembers: 2,
  reservedUntil: null,
  createdAt: '2026-11-20T10:00:00.000Z',
  ...over,
});
const tournament = (over: Partial<Tournament> = {}) =>
  ({ id: 't1', slug: 'copa', name: 'Copa', gameId: 'g1', gameModeId: 'm1', gameName: 'Jogo', status: 'REGISTRATION_OPEN', startsAt: null, rosterLockAt: null, checkIn: { enabled: false, opensMinutesBefore: 30, closesMinutesBefore: 10, requireAllMembers: false }, ...over }) as unknown as Tournament;

const wrap = (node: ReactNode) => render(<ToastProvider>{node}</ToastProvider>);

beforeEach(() => {
  state.add = mutation();
  state.remove = mutation();
  state.move = mutation();
  state.accept = mutation();
  state.user = { id: 'u_cap' };
  state.team = { id: 'team1', name: 'Squad Alfa', tag: 'ALFA', logoUrl: null, captainId: 'u_cap', members: [{ userId: 'u_cap', nickname: 'Capi', avatarUrl: null, role: 'CAPTAIN', isSub: false, joinedAt: '2026-11-01T10:00:00.000Z' }, { userId: 'u_b', nickname: 'Beto', avatarUrl: null, role: 'MEMBER', isSub: false, joinedAt: '2026-11-01T10:00:00.000Z' }, { userId: 'u_c', nickname: 'Caio', avatarUrl: null, role: 'MEMBER', isSub: false, joinedAt: '2026-11-01T10:00:00.000Z' }], pendingInvites: [], createdAt: '2026-11-01T10:00:00.000Z' };
});

describe('RosterDialog (organização)', () => {
  const others = [registration({ id: 'r2', displayName: 'Squad Beta', tag: 'BETA', teamId: 'team2' })];
  const open = () => wrap(<RosterDialog tournament={tournament() as unknown as OrganizerTournamentDetail} registration={registration()} others={others} onClose={() => undefined} />);

  it('remaneja um jogador para outro squad', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: 'Mover Beto para outro squad' }));
    await userEvent.selectOptions(screen.getByLabelText('Mover Beto para'), 'r2');
    await userEvent.click(screen.getByRole('button', { name: 'Mover jogador' }));
    expect(state.move.mutate).toHaveBeenCalledWith({ registrationId: 'r1', userId: 'u_b', toRegistrationId: 'r2' }, expect.anything());
  });

  it('tira um jogador; o capitão não tem botão', async () => {
    open();
    expect(screen.queryByRole('button', { name: 'Tirar Capi do elenco' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Tirar Beto do elenco' }));
    expect(state.remove.mutate).toHaveBeenCalledWith({ registrationId: 'r1', userId: 'u_b' }, expect.anything());
  });

  it('escala pelo apelido (sem apelido, pede o campo)', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: 'Escalar' }));
    expect(await screen.findByText('Informe o apelido do jogador.')).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Apelido do jogador'), '@Dani');
    await userEvent.click(screen.getByRole('button', { name: 'Escalar' }));
    expect(state.add.mutate).toHaveBeenCalledWith({ registrationId: 'r1', input: { nickname: '@Dani' } }, expect.anything());
  });
});

describe('MyRegistrationCard (elenco)', () => {
  it('capitão troca o elenco até a trava: tira membros e escala quem está fora', async () => {
    wrap(<MyRegistrationCard tournament={tournament({ rosterLockAt: '2099-01-01T12:00:00.000Z' })} registration={registration()} viewerId="u_cap" />);
    expect(screen.getByText(/O capitão pode trocar o elenco até/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Tirar Beto do elenco' }));
    expect(state.remove.mutate).toHaveBeenCalledWith({ registrationId: 'r1', userId: 'u_b' }, expect.anything());
    await userEvent.click(await screen.findByRole('button', { name: 'Escalar Caio' }));
    expect(state.add.mutate).toHaveBeenCalledWith({ registrationId: 'r1', input: { userId: 'u_c' } }, expect.anything());
  });

  it('depois da trava o capitão não mexe mais', () => {
    wrap(<MyRegistrationCard tournament={tournament({ rosterLockAt: '2020-01-01T12:00:00.000Z' })} registration={registration()} viewerId="u_cap" />);
    expect(screen.queryByRole('button', { name: 'Tirar Beto do elenco' })).toBeNull();
    expect(screen.queryByText(/O capitão pode trocar o elenco/)).toBeNull();
  });

  it('membro com confirmação pendente vê o pedido em destaque, antes do elenco', () => {
    wrap(<MyRegistrationCard tournament={tournament()} registration={registration({ status: 'PENDING_MEMBERS', members: [member('u_cap', 'Capi', { isCaptain: true }), member('u_b', 'Beto', { confirmedAt: null })] })} viewerId="u_b" />);
    const box = screen.getByTestId('confirm-participation');
    expect(within(box).getByRole('button', { name: 'Confirmar participação' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Tirar/ })).toBeNull();
    // O pedido vem antes da lista do elenco.
    expect(box.compareDocumentPosition(screen.getByRole('list', { name: 'Elenco do Squad Alfa' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('TeamInvitePage (entrar no squad já escala no campeonato)', () => {
  it('depois de aceitar, mostra os campeonatos em que entrou no elenco e o que falta', async () => {
    state.user = { id: 'u_c' };
    state.preview = { code: 'ALFA42', state: 'VALID', team: { id: 'team1', name: 'Squad Alfa', tag: 'ALFA', logoUrl: null, memberCount: 2 }, invitedByNickname: 'Capi', invitedNickname: null, expiresAt: '2099-01-01T00:00:00.000Z', viewerIsMember: false, viewerIsNotInvitee: false };
    const result: AcceptTeamInviteResult = {
      ...(state.team as Team),
      rosters: [
        { registrationId: 'r1', tournamentId: 't1', tournamentName: 'Copa Um', tournamentSlug: 'copa-um', confirmed: true },
        { registrationId: 'r9', tournamentId: 't9', tournamentName: 'Copa Dois', tournamentSlug: 'copa-dois', confirmed: false },
      ],
    };
    state.accept.mutate = vi.fn((_v: unknown, o?: Opts): void => o?.onSuccess?.(result as never));
    wrap(<TeamInvitePage code="ALFA42" />);
    await userEvent.click(screen.getByRole('button', { name: 'Aceitar convite' }));
    const box = await screen.findByTestId('joined-rosters');
    expect(within(box).getByText(/Sua participação já está confirmada/)).toBeTruthy();
    expect(within(box).getByRole('link', { name: 'Ver campeonato' }).getAttribute('href')).toBe('/c/copa-um');
    expect(within(box).getByRole('link', { name: 'Confirmar participação' }).getAttribute('href')).toBe('/c/copa-dois');
  });
});
