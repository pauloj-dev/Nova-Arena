import type { Match, MatchStatus, Registration } from '@nova/schemas';
import { ToastProvider } from '@nova/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildStage } from '@/features/brackets/test/fixtures';
import { ApiError } from '@/shared/api/client';
import { formatTime } from '@/shared/lib/datetime';
import { lobbyWaitingText } from './LobbyPanel';
import { MatchCard } from './MatchCard';
import { MatchViewerProvider, type MatchViewer } from './viewer';

const NOW = new Date('2026-11-12T22:40:00.000Z').getTime();
const MIN = 60_000;
const iso = (offsetMin: number) => new Date(NOW + offsetMin * MIN).toISOString();

const checkIn = { mutate: vi.fn(), isPending: false };
const lobby: { isPending: boolean; isError: boolean; isFetching: boolean; error: unknown; data: { code: string; password: string | null; revealedAt: string } | undefined; refetch: ReturnType<typeof vi.fn> } = {
  isPending: false,
  isError: false,
  isFetching: false,
  error: null,
  data: undefined,
  refetch: vi.fn(),
};
const lobbyCalls: string[] = [];

vi.mock('@/shared/api/hooks/competition', () => ({
  useCheckIn: () => checkIn,
  useMatchLobby: (id: string) => {
    lobbyCalls.push(id);
    return lobby;
  },
}));
// Componentes de outras frentes: aqui só importa onde o cartão os coloca.
vi.mock('@/features/disputes/MatchResultActions', () => ({ MatchResultActions: ({ match }: { match: Match }) => <div data-testid="result-actions">{match.id}</div> }));
vi.mock('@/features/reports/ReportButton', () => ({ ReportButton: ({ targetId, targetType }: { targetId: string; targetType: string }) => <button type="button" data-testid="report-button" data-target={`${targetType}:${targetId}`} /> }));

function problem(status: number, code: string, detail: string): ApiError {
  return new ApiError({ type: 'about:blank', title: detail, status, detail, code });
}

function registration(patch: Partial<Registration> = {}): Registration {
  return { id: 'r8', tournamentId: 'tn_1', displayName: 'Squad 8', tag: null, logoUrl: null, userId: 'u_me', teamId: null, status: 'CONFIRMED', seed: 8, waitlistPosition: null, statusReason: null, members: [], requiredMembers: 1, reservedUntil: null, createdAt: iso(-10_000), ...patch };
}
const squadMember = (userId: string, isCaptain: boolean): Registration['members'][number] => ({ userId, nickname: userId, avatarUrl: null, isCaptain, isSub: false, confirmedAt: iso(-1000), hasGameAccount: true });

const VISITOR: MatchViewer = { userId: null, registration: null, checkIn: null };
const ME: MatchViewer = { userId: 'u_me', registration: registration(), checkIn: { requireAllMembers: false } };

/** Quartas de final: Squad 1 x Squad 8 (a inscrição `r8` é a de quem está vendo). */
function duel(patch: Partial<Match> = {}, mine: Partial<Match['participants'][number]> = {}): Match {
  const base = buildStage('SINGLE_ELIM', 8, { bestOf: 3 }).matches().find((m) => m.nodeId === 'w-r1-m1') as Match;
  return { ...base, scheduledAt: iso(20), checkInOpensAt: iso(-10), checkInClosesAt: iso(10), status: 'CHECK_IN', ...patch, participants: base.participants.map((p) => (p.registrationId === 'r8' ? { ...p, ...mine } : p)) };
}

function finished(status: MatchStatus = 'VALIDATED'): Match {
  const stage = buildStage('SINGLE_ELIM', 8, { bestOf: 3 });
  stage.play('w-r1-m1', 1); // Squad 8 vence por 2 a 0
  return { ...(stage.matches().find((m) => m.nodeId === 'w-r1-m1') as Match), status, walkover: status === 'WALKOVER', scheduledAt: iso(-60), checkInOpensAt: iso(-90), checkInClosesAt: iso(-70) };
}

function renderCard(ui: ReactNode, viewer?: MatchViewer) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{viewer ? <MatchViewerProvider value={viewer}>{ui}</MatchViewerProvider> : ui}</ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  checkIn.mutate.mockReset();
  checkIn.isPending = false;
  Object.assign(lobby, { isPending: false, isError: false, isFetching: false, error: null, data: undefined });
  lobby.refetch.mockReset();
  lobbyCalls.length = 0;
});
afterEach(() => vi.useRealTimers());

describe('MatchCard — estados do contrato (duelo)', () => {
  it.each([
    ['SCHEDULED', 'Agendada'],
    ['CHECK_IN', 'Check-in'],
    ['LIVE', 'Ao vivo'],
    ['AWAITING_VALIDATION', 'Aguardando validação'],
    ['DISPUTED', 'Em disputa'],
    ['CANCELLED', 'Cancelada'],
  ] as [MatchStatus, string][])('%s mostra o status "%s" com os dois lados, a série e o horário com fuso', (status, label) => {
    renderCard(<MatchCard match={duel({ status })} viewer={VISITOR} />);
    const card = screen.getByTestId('match-card');
    expect(card).toHaveAttribute('data-status', status);
    expect(within(card).getByText(label)).toBeInTheDocument();
    expect(within(card).getByRole('heading', { level: 3, name: 'Quartas de final' })).toBeInTheDocument();
    expect(within(card).getByText(/MD3 \(melhor de 3\)/)).toBeInTheDocument();
    const sides = within(card).getByRole('list', { name: 'Lados do confronto' });
    expect(within(sides).getAllByRole('listitem').map((li) => li.textContent)).toEqual([expect.stringContaining('Squad 1'), expect.stringContaining('Squad 8')]);
    expect(within(card).getByText(new RegExp(`${formatTime(iso(20))} · `))).toBeInTheDocument();
    // Visitante não vê check-in, sala nem ações de resultado.
    expect(screen.queryByTestId('checkin-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lobby-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('result-actions')).not.toBeInTheDocument();
  });

  it('mensagens próprias de cada estado', () => {
    const { unmount } = renderCard(<MatchCard match={duel({ status: 'AWAITING_VALIDATION' })} viewer={VISITOR} />);
    expect(screen.getByText('Resultado enviado. A organização ainda vai validar.')).toBeInTheDocument();
    unmount();
    renderCard(<MatchCard match={duel({ status: 'DISPUTED' })} viewer={VISITOR} />);
    expect(screen.getByText('O resultado foi contestado e está em análise pela organização.')).toBeInTheDocument();
  });

  it('VALIDATED: placar, vencedor marcado com ícone + texto (não só cor) e botão de denúncia', () => {
    renderCard(<MatchCard match={finished()} viewer={VISITOR} />);
    expect(screen.getByText('Concluída')).toBeInTheDocument();
    const [loser, winner] = within(screen.getByRole('list', { name: 'Lados do confronto' })).getAllByRole('listitem');
    expect(within(winner as HTMLElement).getByText('vencedor')).toBeInTheDocument();
    expect(within(winner as HTMLElement).getByText('Squad 8')).toHaveClass('font-bold');
    expect(within(loser as HTMLElement).queryByText('vencedor')).not.toBeInTheDocument();
    expect(winner).toHaveTextContent('2');
    expect(loser).toHaveTextContent('0');
    expect(screen.getByText('Squad 8 venceu por 2 a 0.')).toBeInTheDocument();
    expect(screen.getByTestId('report-button')).toHaveAttribute('data-target', expect.stringMatching(/^MATCH:st_1~w-r1-m1$/));
  });

  it('WALKOVER: status W.O. e quem levou', () => {
    renderCard(<MatchCard match={finished('WALKOVER')} viewer={VISITOR} />);
    expect(screen.getByText('W.O.')).toBeInTheDocument();
    expect(screen.getByText('Squad 8 venceu por W.O.')).toBeInTheDocument();
  });

  it('partida sem resultado não tem botão de denúncia; vaga vazia mostra de onde vem o ocupante', () => {
    const semi = buildStage('SINGLE_ELIM', 8).matches().find((m) => m.nodeId === 'w-r2-m1') as Match;
    renderCard(<MatchCard match={semi} viewer={VISITOR} />);
    expect(screen.queryByTestId('report-button')).not.toBeInTheDocument();
    expect(screen.getByText('Vencedor: Quartas de final 1')).toBeInTheDocument();
    expect(screen.getByText('Horário a definir')).toBeInTheDocument();
  });

  it('destaca o lado de quem está vendo e coloca as ações de resultado só nas partidas dele', () => {
    renderCard(<MatchCard match={duel()} />, ME);
    expect(screen.getByText('Sua partida')).toBeInTheDocument();
    expect(screen.getByText('Você')).toBeInTheDocument();
    expect(screen.getByTestId('result-actions')).toHaveTextContent('st_1~w-r1-m1');
    // Lê o `viewer` do contexto quando a prop não vem.
    expect(screen.getByTestId('checkin-panel')).toBeInTheDocument();
  });

  it('variante compacta: o título vira o botão que abre o detalhe, sem check-in nem sala', () => {
    const onOpen = vi.fn();
    const match = duel();
    renderCard(<MatchCard match={match} viewer={ME} variant="compact" onOpen={onOpen} headingLevel={4} />);
    expect(screen.queryByTestId('checkin-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lobby-panel')).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('heading', { level: 4 })).getByRole('button', { name: /^Quartas de final: Squad 1 contra Squad 8, .*check-in aberto, seu confronto\. Abrir detalhes$/ }));
    expect(onOpen).toHaveBeenCalledWith(match);
  });
});

describe('MatchCard — queda de Battle Royale', () => {
  const stage = () => buildStage('GROUPS', 24, { groupCount: 2, groupMode: 'BATTLE_ROYALE', drops: 2 });

  it('antes do resultado lista as equipes da sala, em bloco colapsável', () => {
    const drop = stage().matches()[0] as Match;
    renderCard(<MatchCard match={drop} viewer={VISITOR} />);
    expect(screen.getByRole('heading', { name: 'Grupo A · Queda 1' })).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: /12 equipes na sala/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(screen.getByRole('list', { name: 'Equipes na sala' })).getAllByRole('listitem')).toHaveLength(12);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list', { name: 'Equipes na sala' })).not.toBeInTheDocument();
  });

  it('depois do resultado mostra colocação, kills e pontos, com o Booyah e a linha de quem está vendo', () => {
    const s = stage();
    const first = s.matches()[0] as Match;
    s.playLobby(first.nodeId);
    const drop = s.matches()[0] as Match;
    const mine = drop.participants[2] as Match['participants'][number];
    renderCard(<MatchCard match={drop} viewer={{ userId: 'u_me', registration: registration({ id: mine.registrationId as string, teamId: 't_1', userId: null }), checkIn: { requireAllMembers: false } }} />);
    expect(screen.getByText(`Booyah: ${drop.participants[0]?.name}`)).toBeInTheDocument();
    expect(screen.getByText('Seu squad: 3º lugar · 10 kills · 10 pts')).toBeInTheDocument();
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(13);
    expect(within(rows[1] as HTMLElement).getAllByRole('cell').map((c) => c.textContent)).toEqual(['1º', drop.participants[0]?.name, '12', '15']);
  });

  it('na variante compacta a lista começa fechada', () => {
    renderCard(<MatchCard match={stage().matches()[0] as Match} viewer={VISITOR} variant="compact" />);
    expect(screen.getByRole('button', { name: /12 equipes na sala/ })).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('check-in (PAR-07) com relógio simulado', () => {
  it('antes da janela: sem botão, diz a que horas abre', () => {
    const match = duel({ status: 'SCHEDULED', checkInOpensAt: iso(12), checkInClosesAt: iso(32), scheduledAt: iso(42) });
    renderCard(<MatchCard match={match} viewer={ME} />);
    expect(screen.queryByRole('button', { name: 'Fazer check-in' })).not.toBeInTheDocument();
    expect(screen.getByText(`O check-in abre às ${formatTime(iso(12))}`)).toBeInTheDocument();
    expect(screen.queryByTestId('checkin-countdown')).not.toBeInTheDocument();
  });

  it('o botão aparece quando a janela abre e some quando ela fecha', () => {
    const match = duel({ status: 'SCHEDULED', checkInOpensAt: iso(1), checkInClosesAt: iso(3), scheduledAt: iso(13) });
    renderCard(<MatchCard match={match} viewer={ME} />);
    expect(screen.queryByRole('button', { name: 'Fazer check-in' })).not.toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(MIN));
    expect(screen.getByRole('button', { name: 'Fazer check-in' })).toBeInTheDocument();
    expect(screen.getByTestId('checkin-countdown')).toHaveTextContent('02:00');
    act(() => void vi.advanceTimersByTime(2 * MIN));
    expect(screen.queryByRole('button', { name: 'Fazer check-in' })).not.toBeInTheDocument();
    expect(screen.getByText('O check-in fechou sem a presença confirmada')).toBeInTheDocument();
  });

  it('contagem regressiva até o fechamento, atualizada a cada segundo, com aviso discreto para leitor de tela', () => {
    renderCard(<MatchCard match={duel()} viewer={ME} />);
    const countdown = screen.getByTestId('checkin-countdown');
    expect(countdown).toHaveTextContent('10:00');
    expect(countdown).toHaveAttribute('role', 'timer');
    expect(countdown).toHaveAttribute('aria-live', 'off');
    const spoken = screen.getByText('Faltam 10 minutos para o check-in fechar.');
    expect(spoken).toHaveAttribute('aria-live', 'polite');
    act(() => void vi.advanceTimersByTime(1000));
    expect(countdown).toHaveTextContent('09:59');
    act(() => void vi.advanceTimersByTime(1000));
    expect(countdown).toHaveTextContent('09:58');
    // O texto falado não muda a cada segundo.
    expect(spoken).toHaveTextContent('Faltam 10 minutos para o check-in fechar.');
    act(() => void vi.advanceTimersByTime(58_000));
    expect(countdown).toHaveTextContent('09:00');
    expect(spoken).toHaveTextContent('Faltam 9 minutos para o check-in fechar.');
  });

  it('fazer check-in chama a API; depois mostra "Check-in feito" e o botão some', () => {
    checkIn.mutate.mockImplementation((_id: string, opts: { onSuccess: () => void }) => opts.onSuccess());
    renderCard(<MatchCard match={duel()} viewer={ME} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fazer check-in' }));
    expect(checkIn.mutate).toHaveBeenCalledWith('st_1~w-r1-m1', expect.anything());
    expect(within(screen.getByTestId('checkin-panel')).getByText('Check-in feito')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fazer check-in' })).not.toBeInTheDocument();
  });

  it('quando a API já diz que o check-in foi feito, não oferece o botão', () => {
    renderCard(<MatchCard match={duel({}, { checkedIn: true })} viewer={ME} />);
    expect(within(screen.getByTestId('checkin-panel')).getByText('Check-in feito')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fazer check-in' })).not.toBeInTheDocument();
    // Cada lado mostra a situação do check-in enquanto a janela está aberta.
    expect(screen.getByText('check-in feito')).toBeInTheDocument();
    expect(screen.getByText('aguardando check-in')).toBeInTheDocument();
  });

  it('erro 403/409 da API aparece com a mensagem dela', () => {
    checkIn.mutate.mockImplementation((_id: string, opts: { onError: (e: unknown) => void }) => opts.onError(problem(409, 'CHECKIN_CLOSED', 'A janela de check-in já fechou.')));
    renderCard(<MatchCard match={duel()} viewer={ME} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fazer check-in' }));
    expect(within(screen.getByTestId('checkin-panel')).getByRole('alert')).toHaveTextContent('A janela de check-in já fechou.');
  });

  it('squad: o capitão vê o botão; os outros membros veem quem faz', () => {
    const squad = registration({ teamId: 't_alfa', userId: null, members: [squadMember('u_cap', true), squadMember('u_me', false)] });
    const { unmount } = renderCard(<MatchCard match={duel()} viewer={{ userId: 'u_me', registration: squad, checkIn: { requireAllMembers: false } }} />);
    expect(screen.queryByRole('button', { name: 'Fazer check-in' })).not.toBeInTheDocument();
    expect(screen.getByText('Quem faz o check-in do squad é o capitão.')).toBeInTheDocument();
    expect(screen.getByTestId('checkin-countdown')).toBeInTheDocument();
    unmount();

    renderCard(<MatchCard match={duel()} viewer={{ userId: 'u_cap', registration: squad, checkIn: { requireAllMembers: false } }} />);
    expect(screen.getByRole('button', { name: 'Fazer check-in' })).toBeInTheDocument();
    expect(screen.getByText('Você é o capitão: o seu check-in vale para o squad inteiro.')).toBeInTheDocument();
  });

  it('squad com "todos precisam": qualquer titular faz, e fica avisado de que faltam os outros', () => {
    checkIn.mutate.mockImplementation((_id: string, opts: { onSuccess: () => void }) => opts.onSuccess());
    const squad = registration({ teamId: 't_alfa', userId: null, members: [squadMember('u_cap', true), squadMember('u_me', false)] });
    renderCard(<MatchCard match={duel()} viewer={{ userId: 'u_me', registration: squad, checkIn: { requireAllMembers: true } }} />);
    expect(screen.getByText('Neste campeonato, todos os titulares do squad precisam fazer check-in.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fazer check-in' }));
    expect(screen.getByText('Seu check-in está feito. Falta o de outros titulares do squad.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fazer check-in' })).not.toBeInTheDocument();
  });

  it('depois da partida: sem check-in; em W.O. diz o que aconteceu', () => {
    const { unmount } = renderCard(<MatchCard match={finished()} viewer={ME} />);
    expect(screen.queryByTestId('checkin-panel')).not.toBeInTheDocument();
    unmount();
    const lost = finished('WALKOVER');
    renderCard(<MatchCard match={lost} viewer={{ ...ME, registration: registration({ id: 'r1' }) }} />);
    expect(within(screen.getByTestId('checkin-panel')).getByText('Você levou W.O. nesta partida.')).toBeInTheDocument();
  });

  it('quem não está na partida não vê check-in, mesmo logado', () => {
    renderCard(<MatchCard match={duel()} viewer={{ ...ME, registration: registration({ id: 'r5' }) }} />);
    expect(screen.queryByTestId('checkin-panel')).not.toBeInTheDocument();
    expect(screen.queryByText('Sua partida')).not.toBeInTheDocument();
  });

  it('partida sem janela de check-in não mostra o bloco', () => {
    renderCard(<MatchCard match={duel({ status: 'SCHEDULED', checkInOpensAt: null, checkInClosesAt: null })} viewer={ME} />);
    expect(screen.queryByTestId('checkin-panel')).not.toBeInTheDocument();
  });
});

describe('sala da partida', () => {
  it('só consulta e mostra a sala para quem está na partida', () => {
    renderCard(<MatchCard match={duel({ hasLobby: true })} viewer={VISITOR} />);
    expect(screen.queryByTestId('lobby-panel')).not.toBeInTheDocument();
    renderCard(<MatchCard match={duel({ hasLobby: true })} viewer={{ ...ME, registration: registration({ id: 'r5' }) }} />);
    expect(screen.queryByTestId('lobby-panel')).not.toBeInTheDocument();
    expect(lobbyCalls).toHaveLength(0);
  });

  it('mostra código e senha com botões de copiar', async () => {
    vi.useRealTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    lobby.data = { code: 'NOVA-7Q2', password: '4821', revealedAt: iso(0) };
    renderCard(<MatchCard match={duel({ hasLobby: true })} viewer={ME} />);
    const panel = screen.getByRole('region', { name: 'Sala da partida' });
    expect(within(panel).getByTestId('lobby-code')).toHaveTextContent('NOVA-7Q2');
    expect(within(panel).getByTestId('lobby-password')).toHaveTextContent('4821');
    fireEvent.click(within(panel).getByRole('button', { name: 'Copiar código da sala' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Copiar senha da sala' }));
    expect(writeText.mock.calls).toEqual([['NOVA-7Q2'], ['4821']]);
    expect(await screen.findByText('Código copiado')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it.each([
    ['LOBBY_NOT_REVEALED', 403, 'A sala será liberada perto do horário da partida.'],
    ['LOBBY_NOT_SET', 404, 'A organização ainda não informou a sala.'],
    ['FORBIDDEN', 403, 'A sala só é mostrada para quem está nesta partida.'],
  ])('%s vira aviso neutro ("a sala aparece aqui perto do horário"), sem erro vermelho', (code, status, detail) => {
    Object.assign(lobby, { isError: true, error: problem(status, code, detail) });
    renderCard(<MatchCard match={duel({ hasLobby: code !== 'LOBBY_NOT_SET' })} viewer={ME} />);
    const panel = screen.getByRole('region', { name: 'Sala da partida' });
    const message = within(panel).getByText(/aparece aqui perto do horário/);
    expect(message).toHaveClass('text-muted');
    expect(within(panel).queryByRole('alert')).not.toBeInTheDocument();
    expect(within(panel).queryByText('Tentar novamente')).not.toBeInTheDocument();
    expect(within(panel).queryByText(detail)).not.toBeInTheDocument();
    expect(within(panel).queryByTestId('lobby-code')).not.toBeInTheDocument();
  });

  it('explica cada caso e só oferece nova tentativa em falha inesperada', () => {
    const opens = iso(-10);
    expect(lobbyWaitingText(problem(403, 'LOBBY_NOT_REVEALED', 'x'), opens)).toEqual({ text: `A sala aparece aqui perto do horário: ela é liberada às ${formatTime(opens)}.`, retry: false });
    expect(lobbyWaitingText(problem(403, 'LOBBY_NOT_REVEALED', 'x'), null).text).toBe('A sala aparece aqui perto do horário da partida.');
    expect(lobbyWaitingText(problem(404, 'LOBBY_NOT_SET', 'x'), opens).text).toBe('A organização ainda não informou a sala. Ela aparece aqui perto do horário da partida.');
    expect(lobbyWaitingText(problem(401, 'UNAUTHENTICATED', 'x'), opens).retry).toBe(false);
    expect(lobbyWaitingText(new TypeError('rede'), opens)).toEqual({ text: 'Não deu para buscar a sala agora. Ela aparece aqui perto do horário da partida.', retry: true });
  });

  it('busca a sala de novo quando a organização a informa ou o status da partida muda', () => {
    Object.assign(lobby, { isError: true, error: problem(404, 'LOBBY_NOT_SET', 'x') });
    const view = renderCard(<MatchCard match={duel({ hasLobby: false, status: 'SCHEDULED' })} viewer={ME} />);
    expect(lobby.refetch).not.toHaveBeenCalled();
    const client = new QueryClient();
    view.rerender(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MatchCard match={duel({ hasLobby: true, status: 'CHECK_IN' })} viewer={ME} />
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(lobby.refetch).toHaveBeenCalledTimes(1);
  });

  it('partida concluída não mostra mais a sala', () => {
    renderCard(<MatchCard match={{ ...finished(), hasLobby: true }} viewer={ME} />);
    expect(screen.queryByTestId('lobby-panel')).not.toBeInTheDocument();
  });

  it('provas anexadas: miniaturas que abrem ampliadas', () => {
    renderCard(<MatchCard match={{ ...finished(), evidenceUrls: ['https://exemplo.com/a.png', 'https://exemplo.com/b.png'] }} viewer={VISITOR} />);
    const list = screen.getByRole('list', { name: 'Provas do resultado' });
    expect(within(list).getAllByRole('button')).toHaveLength(2);
    fireEvent.click(within(list).getByRole('button', { name: 'Ampliar prova 2 de 2' }));
    const dialog = screen.getByRole('dialog', { name: 'Prova 2 de 2' });
    expect(within(dialog).getByRole('img')).toHaveAttribute('src', 'https://exemplo.com/b.png');
  });
});
