import { Bracket, Match, Standings, SubmitResultResponse, type AdvancePreview, type Podium } from '@nova/schemas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { auditLogs } from './audit';
import { as, call, mutate, setupMockApi } from './testing';

setupMockApi();
afterEach(() => vi.useRealTimers());

const CAMILA = 'u_camila'; // organizadora da Copa Nova FF e da Liga CR
const DIEGO = 'u_diego'; // outro organizador
const BIANCA = 'u_bianca'; // participante da Liga CR
const ANA = 'u_ana'; // admin

const COPA = 'tn_copa_ff';
const S1 = 'tn_copa_ff_s1';
const S2 = 'tn_copa_ff_s2';
const S3 = 'tn_copa_ff_s3';
const LIGA_S1 = 'tn_liga_cr_s1';

function closeRegistration(): void {
  mutate((d) => {
    const t = d.tournaments.find((x) => x.id === COPA);
    if (t) t.status = 'REGISTRATION_CLOSED';
  });
}

/** Lança todas as quedas de uma fase BR: a ordem das vagas vira a colocação; kills decrescentes. */
async function playLobbies(stageId: string): Promise<void> {
  const bracket = Bracket.parse((await call('GET', `/stages/${stageId}/bracket`)).data);
  for (const m of bracket.matches.filter((x) => x.kind === 'LOBBY')) {
    const entries = m.participants.map((p, i) => ({ registrationId: p.registrationId as string, placement: i + 1, kills: m.participants.length - i }));
    const res = await call('PUT', `/matches/${m.id}/result`, { entries });
    expect(res.status, res.detail).toBe(200);
  }
}

/** Joga os duelos prontos até a fase terminar: a primeira vaga vence por 2 a 0. */
async function playDuels(stageId: string): Promise<void> {
  for (let guard = 0; guard < 20; guard += 1) {
    const bracket = Bracket.parse((await call('GET', `/stages/${stageId}/bracket`)).data);
    const ready = bracket.matches.filter((m) => m.kind === 'DUEL' && m.status !== 'VALIDATED' && m.status !== 'WALKOVER' && m.status !== 'CANCELLED' && !m.waitingPrevious);
    if (ready.length === 0) return;
    for (const m of ready) {
      const [a, b] = m.participants;
      const res = await call('PUT', `/matches/${m.id}/result`, { entries: [{ registrationId: a?.registrationId, score: 2 }, { registrationId: b?.registrationId, score: 0 }] });
      expect(res.status, res.detail).toBe(200);
    }
  }
}

describe('chave: gerar, ajustar, confirmar e travar', () => {
  it('só a organização gera; a prévia não aparece para o público', async () => {
    closeRegistration();
    as(BIANCA);
    expect((await call('POST', `/stages/${S1}/generate`, { seeding: 'RANDOM' })).status).toBe(403);
    as(DIEGO);
    expect((await call('POST', `/stages/${S1}/generate`, { seeding: 'RANDOM' })).status).toBe(403);

    as(CAMILA);
    const generated = await call('POST', `/stages/${S1}/generate`, { seeding: 'RANDOM', seed: 'copa-teste' });
    expect(generated.status).toBe(200);
    const preview = Bracket.parse(generated.data);
    expect(preview.state).toBe('PREVIEW');
    expect(preview.seedUsed).toBe('copa-teste');
    expect(preview.groups).toHaveLength(4);

    as(null);
    expect(Bracket.parse((await call('GET', `/stages/${S1}/bracket`)).data).state).toBe('NONE');
  });

  it('exige inscrições fechadas', async () => {
    as(CAMILA);
    const res = await call('POST', `/stages/${S1}/generate`, { seeding: 'RANDOM' });
    expect(res.status).toBe(409);
    expect(res.code).toBe('REGISTRATION_STILL_OPEN');
  });

  it('a mesma seed reproduz a mesma chave (ADR-007)', async () => {
    closeRegistration();
    as(CAMILA);
    const a = Bracket.parse((await call('POST', `/stages/${S1}/generate`, { seeding: 'RANDOM', seed: 'igual' })).data);
    const b = Bracket.parse((await call('POST', `/stages/${S1}/generate`, { seeding: 'RANDOM', seed: 'igual' })).data);
    expect(b.groups).toEqual(a.groups);
    const c = Bracket.parse((await call('POST', `/stages/${S1}/generate`, { seeding: 'RANDOM', seed: 'outra' })).data);
    expect(c.groups).not.toEqual(a.groups);
  });

  it('ajuste manual é auditado e a chave trava depois da 1ª partida concluída (só Admin destrava)', async () => {
    closeRegistration();
    as(CAMILA);
    const preview = Bracket.parse((await call('POST', `/stages/${S1}/generate`, { seeding: 'RANDOM', seed: 'trava' })).data);
    const a = preview.groups[0]?.registrationIds[0] as string;
    const b = preview.groups[1]?.registrationIds[0] as string;
    const swapped = Bracket.parse((await call('PATCH', `/stages/${S1}/seeding`, { a, b })).data);
    expect(swapped.groups[0]?.registrationIds).toContain(b);
    expect(auditLogs().some((l) => l.action === 'BRACKET_SEEDING_CHANGED')).toBe(true);

    expect((await call('POST', `/stages/${S1}/confirm`)).status).toBe(200);
    const confirmed = Bracket.parse((await call('GET', `/stages/${S1}/bracket`)).data);
    const first = confirmed.matches[0] as Match;
    await call('PUT', `/matches/${first.id}/result`, { entries: first.participants.map((p, i) => ({ registrationId: p.registrationId, placement: i + 1, kills: 1 })) });

    const locked = await call('PATCH', `/stages/${S1}/seeding`, { a, b });
    expect(locked.status).toBe(409);
    expect(locked.code).toBe('BRACKET_LOCKED');
    expect((await call('POST', `/stages/${S1}/generate`, { seeding: 'RANDOM' })).code).toBe('BRACKET_LOCKED');
    expect((await call('POST', `/stages/${S1}/unlock`, { reason: 'Erro no sorteio' })).status).toBe(403);
    as(ANA);
    expect((await call('POST', `/stages/${S1}/unlock`, { reason: 'Erro no sorteio' })).status).toBe(200);
  });
});

describe('resultados', () => {
  async function startCopa(): Promise<Bracket> {
    closeRegistration();
    as(CAMILA);
    await call('POST', `/stages/${S1}/generate`, { seeding: 'RANDOM', seed: 'resultados' });
    await call('POST', `/stages/${S1}/confirm`);
    return Bracket.parse((await call('GET', `/stages/${S1}/bracket`)).data);
  }

  it('CT-01: os pontos são calculados no servidor (kill 1, Booyah 3)', async () => {
    const bracket = await startCopa();
    const drop = bracket.matches[0] as Match;
    const [alfa, bravo, charlie] = drop.participants.map((p) => p.registrationId as string);
    const res = await call('PUT', `/matches/${drop.id}/result`, {
      entries: [
        { registrationId: alfa, placement: 1, kills: 7 },
        { registrationId: bravo, placement: 2, kills: 9 },
        { registrationId: charlie, placement: 3, kills: 4 },
      ],
    });
    expect(res.status).toBe(200);
    const parsed = SubmitResultResponse.parse(res.data);
    expect(parsed.results.map((r) => r.points)).toEqual([10, 9, 4]);
    expect(parsed.match.status).toBe('VALIDATED');
    // Mesmo que o cliente mande "points", ele é ignorado (o schema nem aceita o campo).
    const cheat = await call('PUT', `/matches/${bracket.matches[1]?.id}/result`, {
      entries: (bracket.matches[1] as Match).participants.map((p, i) => ({ registrationId: p.registrationId, placement: i + 1, kills: 0, points: 999 })),
    });
    expect(SubmitResultResponse.parse(cheat.data).results.map((r) => r.points)).toEqual([3, 0, 0]);
  });

  it('colocação repetida e kills negativas = 400; quem não é staff = 403', async () => {
    const bracket = await startCopa();
    const drop = bracket.matches[0] as Match;
    const ids = drop.participants.map((p) => p.registrationId as string);
    const repeated = await call('PUT', `/matches/${drop.id}/result`, { entries: ids.map((id) => ({ registrationId: id, placement: 1, kills: 0 })) });
    expect(repeated.status).toBe(400);
    const negative = await call('PUT', `/matches/${drop.id}/result`, { entries: ids.map((id, i) => ({ registrationId: id, placement: i + 1, kills: -1 })) });
    expect(negative.status).toBe(400);
    as(BIANCA);
    const outsider = await call('PUT', `/matches/${drop.id}/result`, { entries: ids.map((id, i) => ({ registrationId: id, placement: i + 1, kills: 0 })) });
    expect(outsider.status).toBe(403);
  });

  it('a mesma Idempotency-Key não grava duas vezes', async () => {
    const bracket = await startCopa();
    const drop = bracket.matches[0] as Match;
    const payload = { entries: drop.participants.map((p, i) => ({ registrationId: p.registrationId, placement: i + 1, kills: 2 })) };
    const first = await call('PUT', `/matches/${drop.id}/result`, payload, { 'Idempotency-Key': 'abc' });
    const second = await call('PUT', `/matches/${drop.id}/result`, payload, { 'Idempotency-Key': 'abc' });
    expect(second.status).toBe(200);
    expect(second.data).toEqual(first.data);
    expect(auditLogs().filter((l) => l.action === 'RESULT_ENTERED')).toHaveLength(1);
  });

  it('CT-08: corrigir um resultado validado exige motivo, recalcula a tabela e fica na auditoria', async () => {
    const bracket = await startCopa();
    const drop = bracket.matches[0] as Match;
    const ids = drop.participants.map((p) => p.registrationId as string);
    await call('PUT', `/matches/${drop.id}/result`, { entries: ids.map((id, i) => ({ registrationId: id, placement: i + 1, kills: 0 })) });
    const before = Standings.parse((await call('GET', `/stages/${S1}/standings`)).data);
    expect(before.groups[0]?.rows[0]?.registrationId).toBe(ids[0]);

    const corrected = { entries: ids.map((id, i) => ({ registrationId: id, placement: ids.length - i, kills: 0 })) };
    expect((await call('PUT', `/matches/${drop.id}/result`, corrected)).code).toBe('CORRECTION_REASON_REQUIRED');
    expect((await call('PUT', `/matches/${drop.id}/result`, { ...corrected, correctionReason: 'Print estava invertido' })).status).toBe(200);

    const after = Standings.parse((await call('GET', `/stages/${S1}/standings`)).data);
    expect(after.groups[0]?.rows[0]?.registrationId).toBe(ids[ids.length - 1]);
    expect(auditLogs().some((l) => l.action === 'RESULT_CORRECTED' && l.reason === 'Print estava invertido' && l.before !== null)).toBe(true);
    const events = (await call<{ type: string }[]>('GET', `/matches/${drop.id}/events`)).data;
    expect(events.map((e) => e.type)).toEqual(['CORRECTED', 'ENTERED']);
  });
});

describe('CT-06 (reduzido): grupos BR → mata-mata → final BR, pela API', () => {
  it('leva o campeonato até o pódio, com avanço de fase e auditoria', async () => {
    closeRegistration();
    as(CAMILA);
    await call('POST', `/stages/${S1}/generate`, { seeding: 'RANDOM', seed: 'ct06' });
    await call('POST', `/stages/${S1}/confirm`);

    // Avançar com partida pendente é recusado.
    expect((await call('GET', `/stages/${S1}/advance`)).code).toBe('STAGE_INCOMPLETE');
    await playLobbies(S1);

    const table = Standings.parse((await call('GET', `/stages/${S1}/standings`)).data);
    expect(table.groups).toHaveLength(4);
    for (const g of table.groups) {
      expect(g.rows.filter((r) => r.qualifying)).toHaveLength(2);
      // 3 quedas, sempre a mesma ordem: o 1º fez 3 Booyahs.
      expect(g.rows[0]?.booyahs).toBe(3);
      expect(g.rows[0]?.perDrop).toHaveLength(3);
    }

    const preview = (await call<AdvancePreview>('GET', `/stages/${S1}/advance`)).data;
    expect(preview.qualified).toHaveLength(8);
    expect(preview.eliminated).toHaveLength(4);
    expect((await call('POST', `/stages/${S1}/advance`)).status).toBe(200);
    expect((await call('POST', `/stages/${S1}/advance`)).code).toBe('ALREADY_ADVANCED');

    // Fase 2: mata-mata até sobrarem 2 finalistas.
    expect(Bracket.parse((await call('GET', `/stages/${S2}/bracket`)).data).state).toBe('PREVIEW');
    expect((await call('POST', `/stages/${S2}/confirm`)).status).toBe(200);
    await playDuels(S2);
    const s2 = Bracket.parse((await call('GET', `/stages/${S2}/bracket`)).data);
    expect(s2.complete).toBe(true);
    expect(s2.matches).toHaveLength(6); // 4 quartas + 2 semifinais

    const toFinal = (await call<AdvancePreview>('POST', `/stages/${S2}/advance`)).data;
    expect(toFinal.qualified).toHaveLength(2);
    await call('POST', `/stages/${S3}/confirm`);
    await playLobbies(S3);

    const finalTable = Standings.parse((await call('GET', `/stages/${S3}/standings`)).data);
    expect(finalTable.overall).toHaveLength(2);
    const [first, second] = finalTable.overall;
    // 5 quedas: o campeão levou 5 Booyahs (3 pts) + 2 kills por queda = 25; o vice, 1 kill por queda = 5.
    expect(first?.points).toBe(25);
    expect(second?.points).toBe(5);

    const finish = await call<Podium>('POST', `/tournaments/${COPA}/finish`, { first: first?.registrationId, second: second?.registrationId, third: null });
    expect(finish.status).toBe(200);
    expect(finish.data.places[0]?.registrationId).toBe(first?.registrationId);
    expect((await call<{ status: string }>('GET', `/tournaments/${COPA}`)).data.status).toBe('FINISHED');
    expect(auditLogs().filter((l) => l.action === 'STAGE_ADVANCED')).toHaveLength(2);
  });
});

describe('check-in, W.O. automático e sala (CT-07)', () => {
  async function biancasMatch(): Promise<Match> {
    as(BIANCA);
    const mine = (await call<Match[]>('GET', '/tournaments/tn_liga_cr/matches?mine=1')).data.map((m) => Match.parse(m));
    const open = mine.find((m) => m.status === 'CHECK_IN');
    expect(open, 'a partida da Bianca deveria estar com check-in aberto').toBeDefined();
    return open as Match;
  }

  it('o código da sala só aparece para quem está na partida, e nunca na partida em si', async () => {
    const match = await biancasMatch();
    expect(JSON.stringify(match)).not.toContain('NOVA-7Q2');
    expect((await call<{ code: string }>('GET', `/matches/${match.id}/lobby`)).data.code).toBe('NOVA-7Q2');
    as('u_p40'); // jogador que não está no campeonato
    expect((await call('GET', `/matches/${match.id}/lobby`)).status).toBe(403);
    as(null);
    expect((await call('GET', `/matches/${match.id}/lobby`)).status).toBe(401);
  });

  it('quem não faz check-in leva W.O. ao fechar a janela, e o adversário avança', async () => {
    const match = await biancasMatch();
    expect((await call('POST', `/matches/${match.id}/check-in`)).status).toBe(200);
    // Outro jogador não faz check-in por ela.
    as('u_p40');
    expect((await call('POST', `/matches/${match.id}/check-in`)).status).toBe(403);

    // A janela fecha 10 min antes da partida (que começa em 20 min): avançamos 15 min.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 15 * 60_000);
    as(null);
    const bracket = Bracket.parse((await call('GET', `/stages/${LIGA_S1}/bracket`)).data);
    const after = bracket.matches.find((m) => m.id === match.id) as Match;
    expect(after.status).toBe('WALKOVER');
    const bianca = after.participants.find((p) => p.name === 'Bianca');
    expect(bianca?.isWinner).toBe(true);
    const semi = bracket.matches.find((m) => m.id === after.nextMatchId);
    expect(semi?.participants.some((p) => p.name === 'Bianca')).toBe(true);

    // Rodar de novo (o "job" entregue duas vezes) não muda nada.
    const again = Bracket.parse((await call('GET', `/stages/${LIGA_S1}/bracket`)).data);
    expect(again.matches.filter((m) => m.status === 'WALKOVER')).toHaveLength(1);
    expect(auditLogs().filter((l) => l.action === 'WALKOVER_APPLIED')).toHaveLength(1);
  });

  it('check-in fora da janela é recusado', async () => {
    const match = await biancasMatch();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 15 * 60_000);
    as(BIANCA);
    expect((await call('POST', `/matches/${match.id}/check-in`)).code).toBe('CHECKIN_CLOSED');
  });
});

describe('desistência e desclassificação (RN-06, RN-05)', () => {
  it('desclassificar no mata-mata dá W.O. ao adversário; moderador não pode', async () => {
    as(CAMILA);
    const bracket = Bracket.parse((await call('GET', `/stages/${LIGA_S1}/bracket`)).data);
    const pending = bracket.matches.find((m) => m.round === 2 && m.status !== 'VALIDATED' && !m.waitingPrevious) as Match;
    const [loser, winner] = pending.participants;

    as(BIANCA);
    expect((await call('POST', `/registrations/${loser?.registrationId}/withdraw`, { kind: 'DISQUALIFIED', reason: 'Uso de hack' })).status).toBe(403);
    as(CAMILA);
    const res = await call('POST', `/registrations/${loser?.registrationId}/withdraw`, { kind: 'DISQUALIFIED', reason: 'Uso de hack' });
    expect(res.status).toBe(200);

    const after = Bracket.parse((await call('GET', `/stages/${LIGA_S1}/bracket`)).data);
    const match = after.matches.find((m) => m.id === pending.id) as Match;
    expect(match.status).toBe('WALKOVER');
    expect(match.participants.find((p) => p.registrationId === winner?.registrationId)?.isWinner).toBe(true);
    expect(auditLogs().some((l) => l.action === 'ENTRANT_DISQUALIFIED' && l.reason === 'Uso de hack')).toBe(true);
  });
});

describe('dados de demonstração', () => {
  it('o Open 8 Ball (finalizado) tem tabela completa e pódio', async () => {
    as(null);
    const table = Standings.parse((await call('GET', '/stages/tn_open_8ball_s1/standings')).data);
    expect(table.overall).toHaveLength(8);
    expect(table.overall.every((r) => r.played === 3)).toBe(true);
    const podium = (await call<Podium>('GET', '/tournaments/tn_open_8ball/podium')).data;
    expect(podium.places).toHaveLength(3);
    expect(podium.places[0]?.registrationId).toBe(table.overall[0]?.registrationId);
  });
});
