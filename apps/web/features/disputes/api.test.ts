/**
 * Regras de envio de resultado pelo participante, validação do staff e disputas
 * aplicadas pela API simulada (PAR-08, ORG-08, RF-19, PRD §16.5).
 */
import { Bracket, Dispute, Match, ResultSubmission, Standings } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { auditLogs } from '@/mocks/audit';
import { matchMetas } from '@/mocks/competition';
import { db } from '@/mocks/db';
import { disputes, submissions } from '@/mocks/handlers/submissions';
import { notifications } from '@/mocks/notify';
import { as, call, mutate, setupMockApi } from '@/mocks/testing';

setupMockApi();

const CAMILA = 'u_camila'; // organizadora da Liga CR
const DIEGO = 'u_diego'; // organizador de outros campeonatos
const BIANCA = 'u_bianca';
const ANA = 'u_ana'; // admin
const LIGA = 'tn_liga_cr';
const LIGA_S1 = 'tn_liga_cr_s1';
const PRINT = 'data:image/jpeg;base64,cHJpbnQ=';
const PROVA = 'data:image/jpeg;base64,cHJvdmE=';

const Submissions = z.array(ResultSubmission);
const Disputes = z.array(Dispute);

interface Scenario {
  match: Match;
  /** Inscrição da Bianca e do adversário. */
  mine: string;
  theirs: string;
  /** Usuário do adversário. */
  opponent: string;
}

/** A partida das quartas da Bianca na Liga CR (pronta, sem resultado). */
async function scenario(): Promise<Scenario> {
  const mine = db().registrations.find((r) => r.tournamentId === LIGA && r.userId === BIANCA)?.id as string;
  const bracket = Bracket.parse((await call('GET', `/stages/${LIGA_S1}/bracket`)).data);
  const match = bracket.matches.find((m) => m.status !== 'VALIDATED' && !m.waitingPrevious && m.participants.some((p) => p.registrationId === mine)) as Match;
  const theirs = match.participants.find((p) => p.registrationId !== mine)?.registrationId as string;
  const opponent = db().registrations.find((r) => r.id === theirs)?.userId as string;
  return { match, mine, theirs, opponent };
}

const payload = (s: Scenario, mineScore = 2, theirsScore = 1, evidenceUrls: string[] = [PRINT]) => ({
  entries: [
    { registrationId: s.mine, score: mineScore },
    { registrationId: s.theirs, score: theirsScore },
  ],
  evidenceUrls,
});

async function submit(s: Scenario): Promise<ResultSubmission> {
  as(BIANCA);
  const res = await call('POST', `/matches/${s.match.id}/submissions`, payload(s));
  expect(res.status, res.detail).toBe(201);
  return ResultSubmission.parse(res.data);
}

const standings = async () => Standings.parse((await call('GET', `/stages/${LIGA_S1}/standings`)).data).overall;
const matchNow = async (id: string) => Match.parse((await call('GET', `/matches/${id}`)).data);
const titlesFor = (userId: string) => notifications().filter((n) => n.userId === userId).map((n) => n.title);

/** Faz o prazo de resposta do adversário vencer. */
function expire(submissionId: string): void {
  mutate(() => {
    const s = submissions().find((x) => x.id === submissionId);
    if (s) s.respondBy = new Date(Date.now() - 60_000).toISOString();
  });
}

describe('envio de resultado pelo participante', () => {
  it('só quem joga a partida envia: visitante 401, outros 403', async () => {
    const s = await scenario();
    as(null);
    expect((await call('POST', `/matches/${s.match.id}/submissions`, payload(s))).status).toBe(401);
    // Organizadora, admin e um jogador de outra partida do mesmo campeonato.
    const outsider = db().registrations.find((r) => r.tournamentId === LIGA && r.id !== s.mine && r.id !== s.theirs)?.userId as string;
    for (const user of [CAMILA, ANA, 'u_lucas', outsider]) {
      as(user);
      const res = await call('POST', `/matches/${s.match.id}/submissions`, payload(s));
      expect(res.status, user).toBe(403);
    }
    expect(submissions()).toHaveLength(0);
  });

  it('sem print = 400', async () => {
    const s = await scenario();
    as(BIANCA);
    const res = await call<{ errors?: Record<string, string> }>('POST', `/matches/${s.match.id}/submissions`, payload(s, 2, 1, []));
    expect(res.status).toBe(400);
    expect(res.code).toBe('VALIDATION');
    expect(res.data.errors?.evidenceUrls).toMatch(/print/);
    expect(submissions()).toHaveLength(0);
  });

  it('placar inválido para a série (MD3) = 400, sem gravar nada', async () => {
    const s = await scenario();
    as(BIANCA);
    expect((await call('POST', `/matches/${s.match.id}/submissions`, payload(s, 3, 1))).status).toBe(400);
    expect((await call('POST', `/matches/${s.match.id}/submissions`, payload(s, 1, 1))).code).toBe('DRAW_NOT_ALLOWED');
    const oneSide = await call('POST', `/matches/${s.match.id}/submissions`, { entries: [{ registrationId: s.mine, score: 2 }], evidenceUrls: [PRINT] });
    expect(oneSide.code).toBe('INVALID_RESULT');
    expect(submissions()).toHaveLength(0);
    expect((await matchNow(s.match.id)).status).toBe(s.match.status);
  });

  it('queda de Battle Royale = 400: quem lança é a organização', async () => {
    mutate((d) => {
      const t = d.tournaments.find((x) => x.id === 'tn_copa_ff');
      if (t) t.status = 'REGISTRATION_CLOSED';
    });
    as(CAMILA);
    await call('POST', '/stages/tn_copa_ff_s1/generate', { seeding: 'RANDOM', seed: 'envio-br' });
    expect((await call('POST', '/stages/tn_copa_ff_s1/confirm')).status).toBe(200);
    const bracket = Bracket.parse((await call('GET', '/stages/tn_copa_ff_s1/bracket')).data);
    const drop = bracket.matches.find((m) => m.kind === 'LOBBY') as Match;
    const registrationId = drop.participants[0]?.registrationId as string;
    const teamId = db().registrations.find((r) => r.id === registrationId)?.teamId;
    const captain = db().teams.find((t) => t.id === teamId)?.captainId as string;

    as(captain);
    const res = await call('POST', `/matches/${drop.id}/submissions`, { entries: [{ registrationId, placement: 1, kills: 9 }], evidenceUrls: [PRINT] });
    expect(res.status).toBe(400);
    expect(res.code).toBe('LOBBY_RESULT_BY_STAFF');
    expect(res.detail).toMatch(/organização/);
  });

  it('marca a partida como aguardando validação, avisa o adversário e não aceita segundo envio', async () => {
    const s = await scenario();
    const before = await standings();
    const sub = await submit(s);
    expect(sub).toMatchObject({ status: 'PENDING', submittedByNickname: 'Bianca', submittedByRegistrationId: s.mine, winnerRegistrationId: s.mine, evidenceUrls: [PRINT], tournamentId: LIGA });
    expect(new Date(sub.respondBy).getTime() - new Date(sub.createdAt).getTime()).toBe(30 * 60_000);
    expect((await matchNow(s.match.id)).status).toBe('AWAITING_VALIDATION');
    expect(titlesFor(s.opponent)).toContain('Confirme o resultado da sua partida');
    // Envio pendente não conta na tabela.
    expect(await standings()).toEqual(before);

    const again = await call('POST', `/matches/${s.match.id}/submissions`, payload(s));
    expect(again.status).toBe(409);
    expect(again.code).toBe('SUBMISSION_EXISTS');
    as(s.opponent);
    expect((await call('POST', `/matches/${s.match.id}/submissions`, payload(s, 0, 2))).code).toBe('SUBMISSION_EXISTS');
  });

  it('o envio ativo é visível aos dois lados e ao staff, e a mais ninguém', async () => {
    const s = await scenario();
    as(BIANCA);
    expect((await call('GET', `/matches/${s.match.id}/submission`)).data).toBeNull();
    const sub = await submit(s);
    for (const user of [BIANCA, s.opponent, CAMILA, ANA]) {
      as(user);
      const res = await call('GET', `/matches/${s.match.id}/submission`);
      expect(res.status, user).toBe(200);
      expect(ResultSubmission.parse(res.data).id).toBe(sub.id);
      expect((await call('GET', `/submissions/${sub.id}`)).status).toBe(200);
    }
    as(DIEGO);
    expect((await call('GET', `/matches/${s.match.id}/submission`)).status).toBe(403);
    expect((await call('GET', `/submissions/${sub.id}`)).status).toBe(403);
    as(null);
    expect((await call('GET', `/matches/${s.match.id}/submission`)).status).toBe(401);
  });
});

describe('confirmação do adversário e validação do staff', () => {
  it('quem enviou não confirma o próprio envio; só o adversário responde', async () => {
    const s = await scenario();
    const sub = await submit(s);
    as(BIANCA);
    const own = await call('POST', `/submissions/${sub.id}/confirm`);
    expect(own.status).toBe(403);
    expect(own.detail).toMatch(/próprio envio/);
    expect((await call('POST', `/submissions/${sub.id}/dispute`, { reason: 'Quero contestar o meu próprio envio', evidenceUrls: [PROVA] })).status).toBe(403);
    for (const user of [CAMILA, ANA, 'u_lucas']) {
      as(user);
      expect((await call('POST', `/submissions/${sub.id}/confirm`)).status, user).toBe(403);
    }
    expect(submissions()[0]?.status).toBe('PENDING');
  });

  it('adversário confirma → staff aprova → partida VALIDATED com pontos calculados pelo servidor', async () => {
    const s = await scenario();
    const before = await standings();
    const sub = await submit(s);

    // Antes da resposta e dentro do prazo, o envio não está na fila nem pode ser aprovado.
    as(CAMILA);
    expect(Submissions.parse((await call('GET', `/tournaments/${LIGA}/submissions`)).data)).toEqual([]);
    expect((await call('PATCH', `/submissions/${sub.id}`, { action: 'approve' })).code).toBe('SUBMISSION_AWAITING_OPPONENT');

    as(s.opponent);
    const confirmed = await call('POST', `/submissions/${sub.id}/confirm`);
    expect(confirmed.status).toBe(200);
    expect(ResultSubmission.parse(confirmed.data).status).toBe('CONFIRMED');
    expect((await call('POST', `/submissions/${sub.id}/confirm`)).code).toBe('SUBMISSION_NOT_PENDING');
    // Confirmado ainda não é oficial.
    expect(await standings()).toEqual(before);
    expect((await matchNow(s.match.id)).status).toBe('AWAITING_VALIDATION');
    expect(titlesFor(CAMILA)).toContain('Resultado para validar');

    // Só o staff do campeonato valida.
    for (const user of [BIANCA, s.opponent, DIEGO]) {
      as(user);
      expect((await call('GET', `/tournaments/${LIGA}/submissions`)).status, user).toBe(403);
      expect((await call('PATCH', `/submissions/${sub.id}`, { action: 'approve' })).status, user).toBe(403);
    }

    as(CAMILA);
    const queue = Submissions.parse((await call('GET', `/tournaments/${LIGA}/submissions`)).data);
    expect(queue.map((x) => x.id)).toEqual([sub.id]);
    const approved = await call('PATCH', `/submissions/${sub.id}`, { action: 'approve' });
    expect(approved.status, approved.detail).toBe(200);
    expect(ResultSubmission.parse(approved.data).status).toBe('APPROVED');

    const match = await matchNow(s.match.id);
    expect(match.status).toBe('VALIDATED');
    expect(match.evidenceUrls).toEqual([PRINT]);
    const bianca = match.participants.find((p) => p.registrationId === s.mine);
    const other = match.participants.find((p) => p.registrationId === s.theirs);
    // Modelo "Coroas + vitória": 1 por coroa + 3 pela vitória. O cliente nunca mandou pontos.
    expect(bianca).toMatchObject({ score: 2, points: 5, isWinner: true });
    expect(other).toMatchObject({ score: 1, points: 1, isWinner: false });
    expect(await standings()).not.toEqual(before);
    expect((await standings()).find((r) => r.registrationId === s.mine)?.wins).toBe((before.find((r) => r.registrationId === s.mine)?.wins ?? 0) + 1);
    expect(auditLogs().some((l) => l.action === 'RESULT_ENTERED' && l.entityId === s.match.id && l.after?.origem === 'SUBMISSION')).toBe(true);

    expect(Submissions.parse((await call('GET', `/tournaments/${LIGA}/submissions`)).data)).toEqual([]);
    expect((await call('PATCH', `/submissions/${sub.id}`, { action: 'approve' })).code).toBe('SUBMISSION_REVIEWED');
    as(BIANCA);
    expect((await call('GET', `/matches/${s.match.id}/submission`)).data).toBeNull();
  });

  it('pendente com o prazo vencido entra na fila e pode ser aprovado sem a resposta do adversário', async () => {
    const s = await scenario();
    const sub = await submit(s);
    expire(sub.id);
    as(CAMILA);
    expect(Submissions.parse((await call('GET', `/tournaments/${LIGA}/submissions`)).data).map((x) => x.id)).toEqual([sub.id]);
    expect((await call('PATCH', `/submissions/${sub.id}`, { action: 'approve' })).status).toBe(200);
    expect((await matchNow(s.match.id)).status).toBe('VALIDATED');
  });

  it('recusar exige motivo, devolve a partida ao estado normal e libera novo envio', async () => {
    const s = await scenario();
    const before = await standings();
    const sub = await submit(s);
    as(CAMILA);
    expect((await call('PATCH', `/submissions/${sub.id}`, { action: 'reject' })).code).toBe('VALIDATION');
    const rejected = await call('PATCH', `/submissions/${sub.id}`, { action: 'reject', reason: 'O print não mostra o placar final.' });
    expect(rejected.status).toBe(200);
    expect(ResultSubmission.parse(rejected.data).status).toBe('REJECTED');
    expect(submissions()[0]).toMatchObject({ rejectReason: 'O print não mostra o placar final.', reviewedByUserId: CAMILA });
    expect((await matchNow(s.match.id)).status).toBe(s.match.status);
    expect(await standings()).toEqual(before);
    expect(titlesFor(BIANCA)).toContain('Seu envio de resultado foi recusado');

    as(s.opponent);
    expect((await call('POST', `/matches/${s.match.id}/submissions`, payload(s, 0, 2))).status).toBe(201);
  });

  it('moderador do campeonato também valida', async () => {
    const s = await scenario();
    const sub = await submit(s);
    expire(sub.id);
    mutate((d) => d.staff.push({ tournamentId: LIGA, userId: 'u_p40', role: 'MODERATOR', addedAt: new Date().toISOString() }));
    as('u_p40');
    expect((await call('GET', `/tournaments/${LIGA}/submissions`)).status).toBe(200);
    expect((await call('PATCH', `/submissions/${sub.id}`, { action: 'approve' })).status).toBe(200);
  });
});

describe('contestação e disputa', () => {
  async function contest(s: Scenario): Promise<{ sub: ResultSubmission; dispute: Dispute }> {
    const sub = await submit(s);
    as(s.opponent);
    const res = await call('POST', `/submissions/${sub.id}/dispute`, { reason: 'O placar real foi 2 a 1 para mim, não para ela.', evidenceUrls: [PROVA] });
    expect(res.status, res.detail).toBe(201);
    return { sub, dispute: Dispute.parse(res.data) };
  }

  it('contestar sem prova = 400', async () => {
    const s = await scenario();
    const sub = await submit(s);
    as(s.opponent);
    const res = await call<{ errors?: Record<string, string> }>('POST', `/submissions/${sub.id}/dispute`, { reason: 'O placar real foi outro, tenho certeza.', evidenceUrls: [] });
    expect(res.status).toBe(400);
    expect(res.data.errors?.evidenceUrls).toMatch(/prova/);
    expect((await call('POST', `/submissions/${sub.id}/dispute`, { reason: 'curto', evidenceUrls: [PROVA] })).status).toBe(400);
    expect(disputes()).toHaveLength(0);
    expect(submissions()[0]?.status).toBe('PENDING');
  });

  it('contestação: a tabela não muda até a disputa ser resolvida', async () => {
    const s = await scenario();
    const before = await standings();
    const { sub, dispute } = await contest(s);

    expect(dispute).toMatchObject({ status: 'OPEN', submissionId: sub.id, matchId: s.match.id, resolution: null, resolvedAt: null });
    expect(dispute.messages).toHaveLength(1);
    expect(dispute.messages[0]).toMatchObject({ authorRole: 'PARTICIPANT', evidenceUrls: [PROVA] });
    expect(submissions()[0]?.status).toBe('CONTESTED');
    expect((await matchNow(s.match.id)).status).toBe('DISPUTED');
    expect(await standings()).toEqual(before);
    expect(titlesFor(BIANCA)).toContain('Seu resultado foi contestado');
    expect(titlesFor(CAMILA)).toContain('Nova disputa para analisar');

    // Contestado não pode ser confirmado nem aprovado pela fila: só pela disputa.
    expect((await call('POST', `/submissions/${sub.id}/confirm`)).code).toBe('SUBMISSION_NOT_PENDING');
    as(CAMILA);
    expect((await call('PATCH', `/submissions/${sub.id}`, { action: 'approve' })).code).toBe('SUBMISSION_CONTESTED');
    expect(Submissions.parse((await call('GET', `/tournaments/${LIGA}/submissions`)).data)).toEqual([]);
    expect(await standings()).toEqual(before);

    // Mensagens e escalonamento também não mexem na tabela.
    expect((await call('POST', `/disputes/${dispute.id}/messages`, { body: 'Vou conferir os dois prints.' })).status).toBe(201);
    expect((await call('POST', `/disputes/${dispute.id}/escalate`)).status).toBe(200);
    expect(await standings()).toEqual(before);
    expect((await matchNow(s.match.id)).status).toBe('DISPUTED');

    // Resolvida com o resultado correto: agora sim a tabela muda.
    as(ANA);
    const resolved = await call('POST', `/disputes/${dispute.id}/resolve`, { resolution: 'Print do adversário confere com a transmissão.', result: { entries: [{ registrationId: s.mine, score: 1 }, { registrationId: s.theirs, score: 2 }] } });
    expect(resolved.status, resolved.detail).toBe(200);
    const after = await standings();
    expect(after).not.toEqual(before);
    expect(after.find((r) => r.registrationId === s.theirs)?.wins).toBe((before.find((r) => r.registrationId === s.theirs)?.wins ?? 0) + 1);
  });

  it('acesso: envolvidos, staff e Admin veem a disputa; os outros não', async () => {
    const s = await scenario();
    const { dispute } = await contest(s);
    for (const user of [BIANCA, s.opponent, CAMILA, ANA]) {
      as(user);
      expect((await call('GET', `/disputes/${dispute.id}`)).status, user).toBe(200);
    }
    for (const user of [DIEGO, 'u_lucas']) {
      as(user);
      expect((await call('GET', `/disputes/${dispute.id}`)).status, user).toBe(403);
      expect((await call('POST', `/disputes/${dispute.id}/messages`, { body: 'Intrometido' })).status, user).toBe(403);
    }
    as(null);
    expect((await call('GET', `/disputes/${dispute.id}`)).status).toBe(401);

    as(BIANCA);
    expect(Disputes.parse((await call('GET', '/me/disputes')).data).map((d) => d.id)).toEqual([dispute.id]);
    expect((await call('GET', `/tournaments/${LIGA}/disputes`)).status).toBe(403);
    as(s.opponent);
    expect(Disputes.parse((await call('GET', '/me/disputes')).data).map((d) => d.id)).toEqual([dispute.id]);
    as(DIEGO);
    expect(Disputes.parse((await call('GET', '/me/disputes')).data)).toEqual([]);
    as(CAMILA);
    expect(Disputes.parse((await call('GET', `/tournaments/${LIGA}/disputes`)).data).map((d) => d.id)).toEqual([dispute.id]);
    expect(Disputes.parse((await call('GET', `/tournaments/${LIGA}/disputes?status=RESOLVED`)).data)).toEqual([]);
  });

  it('mensagens: papel do autor, anexos e aviso aos outros envolvidos', async () => {
    const s = await scenario();
    const { dispute } = await contest(s);
    as(BIANCA);
    const mine = await call('POST', `/disputes/${dispute.id}/messages`, { body: 'Segue o print do fim da partida.', evidenceUrls: [PRINT] });
    expect(mine.status).toBe(201);
    as(CAMILA);
    const hers = Dispute.parse((await call('POST', `/disputes/${dispute.id}/messages`, { body: 'Recebido, vou analisar.' })).data);
    expect(hers.messages.map((m) => [m.authorNickname, m.authorRole, m.evidenceUrls.length])).toEqual([
      [expect.any(String), 'PARTICIPANT', 1],
      ['Bianca', 'PARTICIPANT', 1],
      ['Camila', 'STAFF', 0],
    ]);
    expect((await call('POST', `/disputes/${dispute.id}/messages`, { body: '' })).code).toBe('VALIDATION');
    expect(titlesFor(s.opponent).filter((t) => t === 'Nova mensagem na disputa')).toHaveLength(2);
    // Quem escreveu não é avisado da própria mensagem.
    expect(titlesFor(CAMILA).filter((t) => t === 'Nova mensagem na disputa')).toHaveLength(1);
  });

  it('staff resolve mantendo o resultado enviado: envio aprovado, partida validada, auditoria', async () => {
    const s = await scenario();
    const { sub, dispute } = await contest(s);
    for (const user of [BIANCA, s.opponent, DIEGO]) {
      as(user);
      expect((await call('POST', `/disputes/${dispute.id}/resolve`, { resolution: 'Eu decido!' })).status, user).toBe(403);
      expect((await call('POST', `/disputes/${dispute.id}/escalate`)).status, user).toBe(403);
    }
    as(CAMILA);
    expect((await call('POST', `/disputes/${dispute.id}/resolve`, { resolution: 'ok' })).code).toBe('VALIDATION');
    const res = await call('POST', `/disputes/${dispute.id}/resolve`, { resolution: 'O print da Bianca mostra o placar final.', result: payload(s) });
    expect(res.status, res.detail).toBe(200);
    const resolved = Dispute.parse(res.data);
    expect(resolved).toMatchObject({ status: 'RESOLVED', resolution: 'O print da Bianca mostra o placar final.' });
    expect(resolved.resolvedAt).not.toBeNull();
    expect(submissions().find((x) => x.id === sub.id)?.status).toBe('APPROVED');
    const match = await matchNow(s.match.id);
    expect(match.status).toBe('VALIDATED');
    expect(match.participants.find((p) => p.registrationId === s.mine)).toMatchObject({ points: 5, isWinner: true });
    expect(auditLogs().find((l) => l.action === 'DISPUTE_RESOLVED')).toMatchObject({ actorId: CAMILA, entityType: 'Dispute', entityId: dispute.id, tournamentId: LIGA, before: { status: 'OPEN' }, after: { status: 'RESOLVED', resultadoLancado: true } });
    expect(titlesFor(BIANCA)).toContain('Disputa resolvida');
    expect(titlesFor(s.opponent)).toContain('Disputa resolvida');

    // Encerrada: não resolve de novo, não escala e não recebe mensagem.
    expect((await call('POST', `/disputes/${dispute.id}/resolve`, { resolution: 'De novo, por favor' })).status).toBe(409);
    expect((await call('POST', `/disputes/${dispute.id}/escalate`)).status).toBe(409);
    expect((await call('POST', `/disputes/${dispute.id}/messages`, { body: 'Mais uma coisa' })).code).toBe('DISPUTE_CLOSED');
  });

  it('resolver sem resultado anula o envio e a partida volta a aceitar resultado', async () => {
    const s = await scenario();
    const before = await standings();
    const { sub, dispute } = await contest(s);
    as(CAMILA);
    expect((await call('POST', `/disputes/${dispute.id}/resolve`, { resolution: 'Nenhum dos prints é conclusivo: joguem de novo.' })).status).toBe(200);
    expect(submissions().find((x) => x.id === sub.id)?.status).toBe('REJECTED');
    expect((await matchNow(s.match.id)).status).toBe(s.match.status);
    expect(matchMetas().find((m) => m.id === s.match.id)?.statusOverride).toBeNull();
    expect(await standings()).toEqual(before);
    expect(auditLogs().find((l) => l.action === 'DISPUTE_RESOLVED')?.after).toMatchObject({ resultadoLancado: false });
    as(BIANCA);
    expect((await call('POST', `/matches/${s.match.id}/submissions`, payload(s))).status).toBe(201);
  });

  it('escalar e resolver com resultado corrigido grava auditoria; escalada só o Admin resolve', async () => {
    const s = await scenario();
    const { sub, dispute } = await contest(s);

    as(CAMILA);
    const escalated = await call('POST', `/disputes/${dispute.id}/escalate`);
    expect(escalated.status).toBe(200);
    expect(Dispute.parse(escalated.data).status).toBe('ESCALATED');
    expect(disputes()[0]).toMatchObject({ escalatedByUserId: CAMILA });
    expect(titlesFor(ANA)).toContain('Disputa escalada para análise');
    expect(titlesFor(BIANCA)).toContain('Disputa escalada para a administração');
    expect((await call('POST', `/disputes/${dispute.id}/escalate`)).code).toBe('DISPUTE_NOT_OPEN');

    // Escalada: a organização do campeonato não resolve mais.
    const byOrganizer = await call('POST', `/disputes/${dispute.id}/resolve`, { resolution: 'Decido eu mesma.' });
    expect(byOrganizer.status).toBe(403);
    expect(disputes()[0]?.status).toBe('ESCALATED');

    as(ANA);
    const corrected = { entries: [{ registrationId: s.mine, score: 0 }, { registrationId: s.theirs, score: 2 }], evidenceUrls: [PROVA] };
    const res = await call('POST', `/disputes/${dispute.id}/resolve`, { resolution: 'A prova do adversário mostra 2 a 0. Resultado corrigido.', result: corrected });
    expect(res.status, res.detail).toBe(200);
    expect(Dispute.parse(res.data).status).toBe('RESOLVED');

    // O resultado oficial é o corrigido, não o que foi enviado.
    const match = await matchNow(s.match.id);
    expect(match.status).toBe('VALIDATED');
    expect(match.evidenceUrls).toEqual([PROVA]);
    expect(match.participants.find((p) => p.registrationId === s.theirs)).toMatchObject({ score: 2, points: 5, isWinner: true });
    expect(match.participants.find((p) => p.registrationId === s.mine)).toMatchObject({ score: 0, points: 0, isWinner: false });
    expect(submissions().find((x) => x.id === sub.id)?.status).toBe('REJECTED');

    const logs = auditLogs();
    expect(logs.find((l) => l.action === 'DISPUTE_RESOLVED')).toMatchObject({ actorId: ANA, entityId: dispute.id, before: { status: 'ESCALATED' }, after: { status: 'RESOLVED', resultadoLancado: true }, reason: 'A prova do adversário mostra 2 a 0. Resultado corrigido.' });
    expect(logs.find((l) => l.action === 'RESULT_ENTERED' && l.entityId === s.match.id)).toMatchObject({ actorId: ANA });
    expect(logs.find((l) => l.action === 'RESULT_ENTERED' && l.entityId === s.match.id)?.after?.origem).toBe('DISPUTE');
  });
});
