import type { Match, Registration } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { buildStage } from '@/features/brackets/test/fixtures';
import { formatDate, formatTime, timeZoneLabel } from '@/shared/lib/datetime';
import { checkInDuty, checkInPhase, countdownSpoken, formatCountdown, msUntilClose } from './checkin';
import { filterMatches, groupByDay, NO_FILTERS } from './MatchesList';
import { matchAriaLabel, matchHeading, opponentOf, resultText, slotText } from './matchText';

const NOW = new Date('2026-11-12T22:40:00.000Z').getTime();
const MIN = 60_000;
const iso = (offsetMin: number) => new Date(NOW + offsetMin * MIN).toISOString();
const ZONE = 'America/Sao_Paulo';

describe('checkInPhase', () => {
  const window = { checkInOpensAt: iso(-10), checkInClosesAt: iso(10) };
  it('sem janela (sem horário ou check-in desligado) não há fase', () => {
    expect(checkInPhase({ checkInOpensAt: null, checkInClosesAt: null }, NOW)).toBe('NONE');
  });
  it('antes, durante e depois da janela', () => {
    expect(checkInPhase(window, NOW - 11 * MIN)).toBe('BEFORE');
    expect(checkInPhase(window, NOW - 10 * MIN)).toBe('OPEN'); // abre no instante exato
    expect(checkInPhase(window, NOW)).toBe('OPEN');
    expect(checkInPhase(window, NOW + 10 * MIN - 1)).toBe('OPEN');
    expect(checkInPhase(window, NOW + 10 * MIN)).toBe('CLOSED'); // fecha no instante exato, como a API
  });
});

describe('contagem regressiva', () => {
  it('formata minutos e segundos, e horas quando passa de uma', () => {
    expect(formatCountdown(10 * MIN)).toBe('10:00');
    expect(formatCountdown(9 * MIN + 59_000)).toBe('09:59');
    expect(formatCountdown(999)).toBe('00:01'); // arredonda para cima: nunca mostra 00:00 com a janela aberta
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(-5)).toBe('00:00');
    expect(formatCountdown(62 * MIN + 3_000)).toBe('1:02:03');
  });
  it('msUntilClose não fica negativo', () => {
    expect(msUntilClose({ checkInClosesAt: iso(10) }, NOW)).toBe(10 * MIN);
    expect(msUntilClose({ checkInClosesAt: iso(-1) }, NOW)).toBe(0);
    expect(msUntilClose({ checkInClosesAt: null }, NOW)).toBe(0);
  });
  it('o texto falado muda de minuto em minuto, não a cada segundo', () => {
    expect(countdownSpoken(9 * MIN + 59_000)).toBe('Faltam 10 minutos para o check-in fechar.');
    expect(countdownSpoken(9 * MIN + 1_000)).toBe('Faltam 10 minutos para o check-in fechar.');
    expect(countdownSpoken(9 * MIN)).toBe('Faltam 9 minutos para o check-in fechar.');
    expect(countdownSpoken(45_000)).toBe('Falta menos de 1 minuto para o check-in fechar.');
    expect(countdownSpoken(20_000)).toBe('Faltam menos de 30 segundos para o check-in fechar.');
    expect(countdownSpoken(5_000)).toBe('Faltam menos de 10 segundos para o check-in fechar.');
    expect(countdownSpoken(0)).toBe('A janela de check-in fechou.');
    expect(countdownSpoken(90 * MIN)).toBe('Falta mais de 1 hora para o check-in fechar.');
  });
});

describe('checkInDuty — quem faz o check-in', () => {
  const member = (userId: string, patch: Partial<Registration['members'][number]> = {}): Registration['members'][number] => ({
    userId,
    nickname: userId,
    avatarUrl: null,
    isCaptain: false,
    isSub: false,
    confirmedAt: iso(-1000),
    hasGameAccount: true,
    ...patch,
  });
  const solo = { userId: 'u_bianca', teamId: null, members: [] };
  const squad = { userId: null, teamId: 't_alfa', members: [member('u_cap', { isCaptain: true }), member('u_titular'), member('u_reserva', { isSub: true }), member('u_pendente', { confirmedAt: null })] };

  it('solo: só o próprio jogador, sem explicação', () => {
    expect(checkInDuty(solo, 'u_bianca', false)).toEqual({ mustCheckIn: true, explanation: null });
    expect(checkInDuty(solo, 'u_outro', false).mustCheckIn).toBe(false);
    expect(checkInDuty(null, 'u_bianca', false).mustCheckIn).toBe(false);
    expect(checkInDuty(solo, null, false).mustCheckIn).toBe(false);
  });
  it('squad, padrão: basta o capitão', () => {
    expect(checkInDuty(squad, 'u_cap', false)).toEqual({ mustCheckIn: true, explanation: 'Você é o capitão: o seu check-in vale para o squad inteiro.' });
    expect(checkInDuty(squad, 'u_titular', false)).toEqual({ mustCheckIn: false, explanation: 'Quem faz o check-in do squad é o capitão.' });
  });
  it('squad com "todos precisam": titulares confirmados fazem; reserva e quem não confirmou, não', () => {
    expect(checkInDuty(squad, 'u_titular', true).mustCheckIn).toBe(true);
    expect(checkInDuty(squad, 'u_cap', true).explanation).toBe('Neste campeonato, todos os titulares do squad precisam fazer check-in.');
    expect(checkInDuty(squad, 'u_reserva', true).mustCheckIn).toBe(false);
    expect(checkInDuty(squad, 'u_pendente', true).mustCheckIn).toBe(false);
  });
  it('sem conhecer a regra do campeonato, deixa os titulares tentarem (a API decide)', () => {
    expect(checkInDuty(squad, 'u_titular', null).mustCheckIn).toBe(true);
    expect(checkInDuty(squad, 'u_reserva', null).mustCheckIn).toBe(false);
  });
});

describe('textos da partida', () => {
  const stage = buildStage('SINGLE_ELIM', 8, { bestOf: 3 });
  const scheduled = (patch: Partial<Match> = {}) => ({ ...(stage.matches().find((m) => m.nodeId === 'w-r1-m1') as Match), ...patch });

  it('aria-label completo: rodada, lados, horário com fuso e status', () => {
    const at = '2026-11-14T23:00:00.000Z'; // 20h em Brasília
    expect(matchAriaLabel(scheduled({ scheduledAt: at }), { timeZone: ZONE })).toBe('Quartas de final: Squad 1 contra Squad 8, 14/11 às 20h, horário de Brasília, agendada');
    expect(matchAriaLabel(scheduled(), { timeZone: ZONE })).toBe('Quartas de final: Squad 1 contra Squad 8, horário a definir, agendada');
    expect(matchAriaLabel(scheduled({ scheduledAt: at, status: 'CHECK_IN' }), { timeZone: ZONE, highlightRegistrationId: 'r8' })).toBe(
      'Quartas de final: Squad 1 contra Squad 8, 14/11 às 20h, horário de Brasília, check-in aberto, seu confronto',
    );
  });

  it('usa o fuso informado (o mesmo horário em Manaus é 19h)', () => {
    const label = matchAriaLabel(scheduled({ scheduledAt: '2026-11-14T23:00:00.000Z' }), { timeZone: 'America/Manaus' });
    expect(label).toContain('14/11 às 19h, horário de Manaus');
    expect(timeZoneLabel('America/Manaus')).toBe('horário de Manaus');
    expect(formatTime('2026-11-14T23:00:00.000Z', { timeZone: 'America/Manaus' })).toBe('19h');
  });

  it('concluída diz quem venceu; vaga vazia diz de onde vem o ocupante', () => {
    const played = buildStage('SINGLE_ELIM', 8, { bestOf: 3 });
    played.play('w-r1-m1', 0);
    const list = played.matches();
    const first = list.find((m) => m.nodeId === 'w-r1-m1') as Match;
    expect(resultText(first)).toBe('Squad 1 venceu por 2 a 0');
    expect(matchAriaLabel(first, { timeZone: ZONE })).toBe('Quartas de final: Squad 1 contra Squad 8, horário a definir, concluída, Squad 1 venceu por 2 a 0');
    const semi = list.find((m) => m.nodeId === 'w-r2-m1') as Match;
    expect(semi.participants.map(slotText)).toEqual(['Squad 1', 'Vencedor: Quartas de final 2']);
    expect(matchAriaLabel(semi, { timeZone: ZONE })).toBe('Semifinal: Squad 1 contra a definir (Vencedor: Quartas de final 2), horário a definir, agendada');
    expect(opponentOf(first, 'r1')?.name).toBe('Squad 8');
  });

  it('W.O., queda BR e reset da Grande Final', () => {
    const wo = scheduled({ status: 'WALKOVER', walkover: true });
    wo.participants = [
      { ...(wo.participants[0] as Match['participants'][number]), isWinner: true, score: 2 },
      { ...(wo.participants[1] as Match['participants'][number]), isWinner: false, score: 0 },
    ];
    expect(matchAriaLabel(wo, { timeZone: ZONE })).toBe('Quartas de final: Squad 1 contra Squad 8, horário a definir, Squad 1 venceu por W.O.');

    const br = buildStage('GROUPS', 24, { groupCount: 2, groupMode: 'BATTLE_ROYALE', drops: 2 });
    const drop = br.matches()[0] as Match;
    expect(matchAriaLabel(drop, { timeZone: ZONE })).toBe('Grupo A, Queda 1: 12 equipes, horário a definir, agendada');
    expect(matchHeading({ ...drop, stageName: 'Fase de grupos' })).toBe('Fase de grupos · Grupo A · Queda 1');
    br.playLobby(drop.nodeId);
    expect(resultText(br.matches()[0] as Match)).toMatch(/levou o Booyah$/);

    const reset = buildStage('DOUBLE_ELIM', 4, { grandFinalReset: true })
      .matches()
      .find((m) => m.nodeId === 'gf-2') as Match;
    expect(matchAriaLabel(reset, { timeZone: ZONE })).toContain('só acontece se for necessário');
  });
});

describe('lista de partidas: filtros e agrupamento por dia', () => {
  const stage = buildStage('SINGLE_ELIM', 8);
  stage.play('w-r1-m1', 0);
  const at: Record<string, string | null> = { 'w-r1-m1': iso(-24 * 60), 'w-r1-m2': iso(30), 'w-r1-m3': iso(10), 'w-r1-m4': iso(24 * 60) };
  const matches = stage.matches((node) => ({ scheduledAt: at[node.id] ?? null }));

  it('filtra por fase, status e "minhas partidas"', () => {
    expect(filterMatches(matches, NO_FILTERS, null)).toHaveLength(7);
    expect(filterMatches(matches, { ...NO_FILTERS, status: 'VALIDATED' }, null).map((m) => m.nodeId)).toEqual(['w-r1-m1']);
    expect(filterMatches(matches, { ...NO_FILTERS, mine: true }, 'r1').map((m) => m.nodeId)).toEqual(['w-r1-m1', 'w-r2-m1']);
    expect(filterMatches(matches, { ...NO_FILTERS, mine: true }, null)).toHaveLength(0);
    expect(filterMatches(matches, { ...NO_FILTERS, stageId: 'outra-fase' }, null)).toHaveLength(0);
  });

  it('agrupa por dia no fuso de quem vê, em ordem de horário, com as sem horário por último', () => {
    const days = groupByDay(matches, NOW, ZONE);
    expect(days.map((d) => d.label.split(' · ')[0])).toEqual(['Ontem', 'Hoje', 'Amanhã', 'Sem horário definido']);
    expect(days[0]?.key).toBe(formatDate(iso(-24 * 60), { timeZone: ZONE }));
    expect(days[1]?.matches.map((m) => m.nodeId)).toEqual(['w-r1-m3', 'w-r1-m2']); // 10 min antes de 30 min
    expect(days[3]?.matches).toHaveLength(3);
  });
});
