import type { Dispute, Match, MatchParticipant, Registration, ResultSubmission } from '@nova/schemas';
import { ToastProvider } from '@nova/ui';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatTime } from '@/shared/lib/datetime';
import { MatchResultActions } from './MatchResultActions';

// Testes com muitas interações: folga para quando a máquina está ocupada (CI ou execuções em paralelo).
vi.setConfig({ testTimeout: 30_000 });

const router = { push: vi.fn() };
const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  registration: null as unknown,
  submission: null as unknown,
  submissionPending: false,
  disputes: [] as unknown[],
  tiebreakFields: [] as unknown[],
  create: { mutate: (() => undefined) as (input: unknown, opts?: unknown) => void, isPending: false },
  confirm: { mutate: (() => undefined) as (id: string, opts?: unknown) => void, isPending: false },
  contest: { mutate: (() => undefined) as (input: unknown, opts?: unknown) => void, isPending: false },
  enabled: { registration: [] as boolean[], submission: [] as boolean[], disputes: [] as boolean[] },
  upload: (() => Promise.resolve('')) as (file: File, purpose: string) => Promise<string>,
}));

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/shared/session/useSession', () => ({ useSession: () => ({ user: state.user }) }));
// O envio pelo participante depende da flag `resultSubmission`; aqui ela fica ligada, salvo no teste que a desliga.
const flags = { resultSubmission: true };
vi.mock('@/shared/flags/useFlag', () => ({ useFlag: (key: string) => (key === 'resultSubmission' ? flags.resultSubmission : true) }));
vi.mock('@/shared/api/hooks/registrations', () => ({
  useMyRegistration: (...[, opts]: [string, { enabled?: boolean }]) => {
    state.enabled.registration.push(Boolean(opts.enabled));
    return { data: opts.enabled ? state.registration : undefined };
  },
}));
vi.mock('@/shared/api/hooks/disputes', () => ({
  useMatchSubmission: (...[, enabled]: [string, boolean]) => {
    state.enabled.submission.push(enabled);
    return { data: enabled && !state.submissionPending ? state.submission : undefined, isPending: !enabled || state.submissionPending };
  },
  useMyDisputes: (enabled: boolean) => {
    state.enabled.disputes.push(enabled);
    return { data: enabled ? state.disputes : undefined };
  },
  useCreateSubmission: () => state.create,
  useConfirmSubmission: () => state.confirm,
  useContestSubmission: () => state.contest,
}));
vi.mock('@/shared/api/hooks/tournaments', () => ({ useTournament: (id: string | undefined) => ({ data: id ? { gameId: 'g_1' } : undefined, isLoading: false }) }));
vi.mock('@/shared/api/hooks/games', () => ({ useGame: (id: string | undefined) => ({ data: id ? { extraStatFields: state.tiebreakFields } : undefined, isLoading: false }) }));
vi.mock('@/shared/api/upload', () => ({
  uploadImage: (file: File, purpose: string) => state.upload(file, purpose),
  uploadErrorMessage: () => 'Não foi possível enviar a imagem. Tente de novo.',
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const MIN = 60_000;
type MutateOptions<T = unknown> = { onSuccess?: (data: T) => void; onError?: (e: unknown) => void };
const png = (name: string) => new File(['x'], name, { type: 'image/png' });

function participant(registrationId: string | null, name: string): MatchParticipant {
  return { registrationId, name, tag: null, logoUrl: null, seed: 1, sourceLabel: null, isBye: false, score: null, placement: null, kills: null, absent: false, points: null, isWinner: null, checkedIn: false, stats: {}, playerKills: {}, status: 'ACTIVE' };
}

function duel(patch: Partial<Match> = {}): Match {
  return {
    id: 's1~m1',
    nodeId: 'm1',
    tournamentId: 'tn_1',
    stageId: 's1',
    stageName: 'Mata-mata',
    groupId: null,
    groupName: null,
    round: 2,
    position: 1,
    bracket: 'WINNERS',
    kind: 'DUEL',
    bestOf: 3,
    roundLabel: 'Quartas de final',
    dropIndex: null,
    multiplier: 1,
    ifNecessary: false,
    status: 'LIVE',
    waitingPrevious: false,
    scheduledAt: null,
    checkInOpensAt: null,
    checkInClosesAt: null,
    hasLobby: false,
    participants: [participant('r_bianca', 'Bianca'), participant('r_caio', 'Caio')],
    evidenceUrls: [],
    nextMatchId: null,
    loserNextMatchId: null,
    walkover: false,
    updatedAt: null,
    ...patch,
  };
}

function solo(id: string, userId: string, patch: Partial<Registration> = {}): Registration {
  return { id, tournamentId: 'tn_1', displayName: userId, tag: null, logoUrl: null, userId, teamId: null, status: 'CONFIRMED', seed: null, waitlistPosition: null, statusReason: null, members: [], requiredMembers: 1, reservedUntil: null, createdAt: new Date().toISOString(), ...patch };
}

function squad(id: string, members: { userId: string; isCaptain: boolean }[]): Registration {
  return solo(id, '', {
    userId: null,
    teamId: 't_1',
    members: members.map((m) => ({ userId: m.userId, nickname: m.userId, avatarUrl: null, isCaptain: m.isCaptain, isSub: false, confirmedAt: new Date().toISOString(), hasGameAccount: true })),
  });
}

function submission(patch: Partial<ResultSubmission> = {}): ResultSubmission {
  const now = Date.now();
  return {
    id: 'sub_1',
    matchId: 's1~m1',
    tournamentId: 'tn_1',
    tournamentName: 'Liga',
    matchLabel: 'Quartas de final: Bianca x Caio',
    submittedByNickname: 'Bianca',
    submittedByRegistrationId: 'r_bianca',
    entries: [
      { registrationId: 'r_bianca', score: 2 },
      { registrationId: 'r_caio', score: 1 },
    ],
    winnerRegistrationId: 'r_bianca',
    evidenceUrls: ['data:image/jpeg;base64,PRINT'],
    status: 'PENDING',
    createdAt: new Date(now - 5 * MIN).toISOString(),
    respondBy: new Date(now + 25 * MIN).toISOString(),
    ...patch,
  };
}

const view = (match: Match = duel()) =>
  render(
    <ToastProvider>
      <div data-testid="slot">
        <MatchResultActions match={match} />
      </div>
    </ToastProvider>,
  );
const slot = () => screen.getByTestId('slot');

function asBianca() {
  state.user = { id: 'u_bianca' };
  state.registration = solo('r_bianca', 'u_bianca');
}
function asCaio() {
  state.user = { id: 'u_caio' };
  state.registration = solo('r_caio', 'u_caio');
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  state.user = null;
  state.registration = null;
  state.submission = null;
  state.submissionPending = false;
  state.disputes = [];
  state.tiebreakFields = [];
  state.create = { mutate: vi.fn(), isPending: false };
  state.confirm = { mutate: vi.fn(), isPending: false };
  state.contest = { mutate: vi.fn(), isPending: false };
  state.enabled = { registration: [], submission: [], disputes: [] };
  state.upload = vi.fn(() => Promise.resolve('data:image/jpeg;base64,NOVA'));
  router.push.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe('MatchResultActions: quem não joga a partida', () => {
  it('visitante: não renderiza nada e não consulta a API', () => {
    view();
    expect(slot()).toBeEmptyDOMElement();
    expect(state.enabled.registration).toEqual([false]);
    expect(state.enabled.submission).toEqual([false]);
  });

  it('logado, mas sem inscrição no campeonato (ou organização): nada', () => {
    state.user = { id: 'u_camila' };
    state.registration = null;
    view();
    expect(slot()).toBeEmptyDOMElement();
    expect(state.enabled.submission.every((e) => !e)).toBe(true);
  });

  it('inscrito no campeonato, mas em outra partida: nada', () => {
    state.user = { id: 'u_dani' };
    state.registration = solo('r_dani', 'u_dani');
    view();
    expect(slot()).toBeEmptyDOMElement();
    expect(state.enabled.submission.every((e) => !e)).toBe(true);
  });

  it('inscrição que não está confirmada (desistência): nada', () => {
    state.user = { id: 'u_bianca' };
    state.registration = solo('r_bianca', 'u_bianca', { status: 'WITHDRAWN' });
    view();
    expect(slot()).toBeEmptyDOMElement();
  });

  it('queda de Battle Royale: nada (quem lança é a organização)', () => {
    asBianca();
    view(duel({ kind: 'LOBBY', bracket: null }));
    expect(slot()).toBeEmptyDOMElement();
    expect(state.enabled.registration).toEqual([false]);
  });

  it('partida já concluída, cancelada ou ainda sem os dois lados: nada', () => {
    asBianca();
    for (const match of [duel({ status: 'VALIDATED' }), duel({ status: 'WALKOVER' }), duel({ status: 'CANCELLED' }), duel({ participants: [participant('r_bianca', 'Bianca'), participant(null, 'A definir')], waitingPrevious: true })]) {
      const { unmount } = view(match);
      expect(slot()).toBeEmptyDOMElement();
      unmount();
    }
  });
});

describe('MatchResultActions: enviar resultado', () => {
  it('jogador solo sem envio: botão "Enviar resultado"', () => {
    asBianca();
    view();
    expect(screen.getByRole('button', { name: 'Enviar resultado' })).toBeInTheDocument();
    expect(state.enabled.submission.at(-1)).toBe(true);
  });

  it('com o envio pelos participantes desligado nas configurações, não mostra nada', () => {
    asBianca();
    flags.resultSubmission = false;
    try {
      view();
      expect(slot()).toBeEmptyDOMElement();
      expect(state.enabled.registration.at(-1)).toBe(false);
    } finally {
      flags.resultSubmission = true;
    }
  });

  it('enquanto o envio carrega, não pisca o botão', () => {
    asBianca();
    state.submissionPending = true;
    view();
    expect(slot()).toBeEmptyDOMElement();
  });

  it('membro do squad que não é capitão: só o aviso', () => {
    state.user = { id: 'u_membro' };
    state.registration = squad('r_bianca', [
      { userId: 'u_capitao', isCaptain: true },
      { userId: 'u_membro', isCaptain: false },
    ]);
    view();
    expect(screen.getByText('Quem envia o resultado do squad é o capitão.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enviar resultado' })).not.toBeInTheDocument();
  });

  it('capitão do squad envia', () => {
    state.user = { id: 'u_capitao' };
    state.registration = squad('r_bianca', [
      { userId: 'u_capitao', isCaptain: true },
      { userId: 'u_membro', isCaptain: false },
    ]);
    view();
    expect(screen.getByRole('button', { name: 'Enviar resultado' })).toBeInTheDocument();
  });

  it('formulário: placar dos dois lados, print obrigatório e regra da série', async () => {
    asBianca();
    const user = userEvent.setup();
    view();
    await user.click(screen.getByRole('button', { name: 'Enviar resultado' }));
    const dialog = await screen.findByRole('dialog', { name: 'Enviar resultado' });
    expect(within(dialog).getByText('Quartas de final: Bianca x Caio')).toBeInTheDocument();
    const mine = within(dialog).getByLabelText(/Placar de Bianca \(você\)/);
    const theirs = within(dialog).getByLabelText(/Placar de Caio/);
    const send = within(dialog).getByRole('button', { name: 'Enviar resultado' });

    // Vazio: pede o placar e o print.
    await user.click(send);
    expect(await within(dialog).findAllByText('Informe o placar')).toHaveLength(2);
    expect(state.create.mutate).not.toHaveBeenCalled();

    // Placar válido, sem print.
    await user.type(mine, '2');
    await user.type(theirs, '1');
    await user.click(send);
    expect(await within(dialog).findByText('Anexe pelo menos um print do resultado')).toBeInTheDocument();
    expect(state.create.mutate).not.toHaveBeenCalled();

    // Com print, mas empate em MD3.
    await user.upload(within(dialog).getByLabelText(/Print do resultado/), png('placar.png'));
    expect(await within(dialog).findByRole('img', { name: 'Anexo 1' })).toBeInTheDocument();
    expect(state.upload).toHaveBeenCalledWith(expect.any(File), 'evidence');
    expect(within(dialog).queryByText('Anexe pelo menos um print do resultado')).not.toBeInTheDocument();
    await user.clear(theirs);
    await user.type(theirs, '2');
    await user.click(send);
    expect(await within(dialog).findByText('Uma série melhor de 3 não termina empatada.')).toBeInTheDocument();
    expect(state.create.mutate).not.toHaveBeenCalled();

    // Tudo certo: manda só estatísticas brutas (sem pontos).
    await user.clear(theirs);
    await user.type(theirs, '0');
    await user.click(send);
    await waitFor(() => expect(state.create.mutate).toHaveBeenCalledTimes(1));
    const [input, options] = vi.mocked(state.create.mutate).mock.calls[0] as [unknown, MutateOptions];
    expect(input).toEqual({ entries: [{ registrationId: 'r_bianca', score: 2 }, { registrationId: 'r_caio', score: 0 }], evidenceUrls: ['data:image/jpeg;base64,NOVA'] });
    options.onSuccess?.(undefined);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Resultado enviado')).toBeInTheDocument();
  });

  it('empate em mata-mata de jogo único: campo de desempate do jogo (pênaltis)', async () => {
    asBianca();
    state.tiebreakFields = [{ key: 'penalties', label: 'Pênaltis', when: 'tiebreak' }];
    const user = userEvent.setup();
    view(duel({ bestOf: 1 }));
    await user.click(screen.getByRole('button', { name: 'Enviar resultado' }));
    const dialog = await screen.findByRole('dialog', { name: 'Enviar resultado' });
    expect(within(dialog).queryByLabelText('Pênaltis de Bianca')).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Placar de Bianca/), '1');
    await user.type(within(dialog).getByLabelText(/Placar de Caio/), '1');
    const penA = await within(dialog).findByLabelText('Pênaltis de Bianca');
    await user.upload(within(dialog).getByLabelText(/Print do resultado/), png('placar.png'));
    await within(dialog).findByRole('img', { name: 'Anexo 1' });

    await user.click(within(dialog).getByRole('button', { name: 'Enviar resultado' }));
    expect(await within(dialog).findByText('Informe pênaltis dos dois lados.')).toBeInTheDocument();
    await user.type(penA, '5');
    await user.type(within(dialog).getByLabelText('Pênaltis de Caio'), '4');
    await user.click(within(dialog).getByRole('button', { name: 'Enviar resultado' }));
    await waitFor(() => expect(state.create.mutate).toHaveBeenCalledTimes(1));
    expect(vi.mocked(state.create.mutate).mock.calls[0]?.[0]).toEqual({
      entries: [
        { registrationId: 'r_bianca', score: 1, stats: { penalties: 5 } },
        { registrationId: 'r_caio', score: 1, stats: { penalties: 4 } },
      ],
      evidenceUrls: ['data:image/jpeg;base64,NOVA'],
    });
  });

  it('empate em mata-mata sem campo de desempate: escolhe quem venceu', async () => {
    asBianca();
    const user = userEvent.setup();
    view(duel({ bestOf: 1 }));
    await user.click(screen.getByRole('button', { name: 'Enviar resultado' }));
    const dialog = await screen.findByRole('dialog', { name: 'Enviar resultado' });
    await user.type(within(dialog).getByLabelText(/Placar de Bianca/), '0');
    await user.type(within(dialog).getByLabelText(/Placar de Caio/), '0');
    await user.upload(within(dialog).getByLabelText(/Print do resultado/), png('placar.png'));
    await within(dialog).findByRole('img', { name: 'Anexo 1' });
    await user.click(within(dialog).getByRole('button', { name: 'Enviar resultado' }));
    expect(await within(dialog).findByText('Escolha quem venceu o desempate.')).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText(/Quem venceu o desempate/), 'r_caio');
    await user.click(within(dialog).getByRole('button', { name: 'Enviar resultado' }));
    await waitFor(() => expect(state.create.mutate).toHaveBeenCalledTimes(1));
    expect(vi.mocked(state.create.mutate).mock.calls[0]?.[0]).toMatchObject({ winnerRegistrationId: 'r_caio' });
  });

  it('empate em pontos corridos vale: não pede desempate', async () => {
    asBianca();
    const user = userEvent.setup();
    view(duel({ bestOf: 1, bracket: null }));
    await user.click(screen.getByRole('button', { name: 'Enviar resultado' }));
    const dialog = await screen.findByRole('dialog', { name: 'Enviar resultado' });
    await user.type(within(dialog).getByLabelText(/Placar de Bianca/), '1');
    await user.type(within(dialog).getByLabelText(/Placar de Caio/), '1');
    expect(within(dialog).queryByLabelText(/Quem venceu o desempate/)).not.toBeInTheDocument();
  });
});

describe('MatchResultActions: depois do envio', () => {
  it('quem enviou: aguardando o adversário confirmar, com o prazo', () => {
    asBianca();
    const sent = submission();
    state.submission = sent;
    view(duel({ status: 'AWAITING_VALIDATION' }));
    expect(slot()).toHaveTextContent(`Você enviou Bianca 2 x 1 Caio. Aguardando o adversário confirmar (até ${formatTime(sent.respondBy)}).`);
    expect(screen.queryByRole('button', { name: 'Confirmar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enviar resultado' })).not.toBeInTheDocument();
  });

  it('quem enviou, com o prazo vencido: a organização vai validar', () => {
    asBianca();
    state.submission = submission({ respondBy: new Date(Date.now() - MIN).toISOString() });
    view(duel({ status: 'AWAITING_VALIDATION' }));
    expect(slot()).toHaveTextContent('O adversário não respondeu no prazo: a organização vai validar.');
  });

  it('adversário: vê o placar e o print, e pode confirmar ou contestar', async () => {
    asCaio();
    const sent = submission();
    state.submission = sent;
    const user = userEvent.setup();
    view(duel({ status: 'AWAITING_VALIDATION' }));
    expect(slot()).toHaveTextContent(`Bianca enviou Bianca 2 x 1 Caio. Confirme ou conteste até ${formatTime(sent.respondBy)}.`);
    expect(screen.getByRole('button', { name: 'Abrir print do adversário' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(state.confirm.mutate).toHaveBeenCalledWith('sub_1', expect.anything());
    const [, options] = vi.mocked(state.confirm.mutate).mock.calls[0] as [string, MutateOptions];
    options.onSuccess?.(undefined);
    expect(await screen.findByText('Resultado confirmado')).toBeInTheDocument();
  });

  it('adversário contesta: motivo e prova obrigatória; depois vai para a disputa', async () => {
    asCaio();
    state.submission = submission();
    const user = userEvent.setup();
    view(duel({ status: 'AWAITING_VALIDATION' }));
    await user.click(screen.getByRole('button', { name: 'Contestar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Contestar resultado' });
    expect(within(dialog).getByText('Placar enviado por Bianca: Bianca 2 x 1 Caio')).toBeInTheDocument();
    const send = within(dialog).getByRole('button', { name: 'Contestar resultado' });

    await user.click(send);
    expect(await within(dialog).findByText('Explique o que está errado (pelo menos 10 caracteres)')).toBeInTheDocument();
    expect(within(dialog).getByText('Anexe pelo menos uma prova')).toBeInTheDocument();

    // Com motivo, mas ainda sem prova: não envia.
    await user.type(within(dialog).getByLabelText(/O que está errado/), 'O placar real foi 2 a 1 para mim.');
    await user.click(send);
    await waitFor(() => expect(within(dialog).queryByText('Explique o que está errado (pelo menos 10 caracteres)')).not.toBeInTheDocument());
    expect(within(dialog).getByText('Anexe pelo menos uma prova')).toBeInTheDocument();
    expect(state.contest.mutate).not.toHaveBeenCalled();

    await user.upload(within(dialog).getByLabelText(/Prova/), png('prova.png'));
    await within(dialog).findByRole('img', { name: 'Anexo 1' });
    await user.click(send);
    await waitFor(() => expect(state.contest.mutate).toHaveBeenCalledTimes(1));
    const [input, options] = vi.mocked(state.contest.mutate).mock.calls[0] as [unknown, MutateOptions<Pick<Dispute, 'id'>>];
    expect(input).toEqual({ submissionId: 'sub_1', input: { reason: 'O placar real foi 2 a 1 para mim.', evidenceUrls: ['data:image/jpeg;base64,NOVA'] } });
    options.onSuccess?.({ id: 'dp_7' });
    expect(router.push).toHaveBeenCalledWith('/disputas/dp_7');
  });

  it('adversário com o prazo vencido: sem botões', () => {
    asCaio();
    state.submission = submission({ respondBy: new Date(Date.now() - MIN).toISOString() });
    view(duel({ status: 'AWAITING_VALIDATION' }));
    expect(slot()).toHaveTextContent('O prazo de resposta terminou: a organização vai validar.');
    expect(screen.queryByRole('button', { name: 'Confirmar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Contestar' })).not.toBeInTheDocument();
  });

  it('membro do squad adversário que não é capitão: vê o envio, mas não responde', () => {
    state.user = { id: 'u_membro' };
    state.registration = squad('r_caio', [
      { userId: 'u_capitao', isCaptain: true },
      { userId: 'u_membro', isCaptain: false },
    ]);
    state.submission = submission();
    view(duel({ status: 'AWAITING_VALIDATION' }));
    expect(slot()).toHaveTextContent('O capitão do seu squad confirma ou contesta até');
    expect(screen.queryByRole('button', { name: 'Confirmar' })).not.toBeInTheDocument();
  });

  it('confirmado pelos dois lados: aguardando a organização (para os dois)', () => {
    state.submission = submission({ status: 'CONFIRMED' });
    for (const login of [asBianca, asCaio]) {
      login();
      const { unmount } = view(duel({ status: 'AWAITING_VALIDATION' }));
      expect(slot()).toHaveTextContent('Os dois lados concordam com Bianca 2 x 1 Caio. Aguardando a validação da organização.');
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      unmount();
    }
  });

  it('partida em disputa: link para a disputa em aberto', () => {
    asBianca();
    state.disputes = [
      { id: 'dp_velha', matchId: 's1~m1', status: 'RESOLVED' },
      { id: 'dp_1', matchId: 's1~m1', status: 'OPEN' },
      { id: 'dp_outra', matchId: 's1~m9', status: 'OPEN' },
    ];
    view(duel({ status: 'DISPUTED' }));
    expect(slot()).toHaveTextContent('Resultado em disputa. A tabela só muda quando a organização decidir.');
    expect(screen.getByRole('link', { name: 'Acompanhar a disputa' })).toHaveAttribute('href', '/disputas/dp_1');
    // Em disputa não consulta o envio; consulta as minhas disputas.
    expect(state.enabled.submission.at(-1)).toBe(false);
    expect(state.enabled.disputes.at(-1)).toBe(true);
  });

  it('"aguardando validação" sem envio visível (lançado pelo staff): nada', () => {
    asBianca();
    state.submission = null;
    view(duel({ status: 'AWAITING_VALIDATION' }));
    expect(slot()).toBeEmptyDOMElement();
  });
});
