/**
 * Envio de resultado pelo participante, validação do staff e disputas contra um Postgres de verdade — issue #90.
 * Porta de `apps/web/features/disputes/api.test.ts` (a especificação), cenário a cenário. Critérios de aceite:
 * resultado contestado não altera a tabela até ser resolvido; só participantes da partida enviam ou contestam.
 */
import { Bracket, Dispute, Match, ResultSubmission, Standings } from '@nova/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DUEL_TB, SERIES_RULES, createHarness, type Harness } from './fixtures/arena';

const url = process.env.TEST_DATABASE_URL;
const Submissions = z.array(ResultSubmission);
const Disputes = z.array(Dispute);

describe.skipIf(!url)('envio de resultado e disputas (Postgres)', { timeout: 60_000 }, () => {
  let h: Harness;
  let cr: Awaited<ReturnType<Harness['game']>>;
  let n = 0;

  interface Scenario {
    t: { id: string; slug: string; stageIds: string[] };
    stageId: string;
    match: Match;
    /** Chaves das pessoas deste cenário. */
    org: string;
    mod: string;
    bianca: string;
    opponent: string;
    other: string;
    mine: string;
    theirs: string;
    print: string;
  }

  /** Uma Liga CR nova (MD3), com a partida da "Bianca" pronta e sem resultado. Pessoas novas a cada cenário. */
  async function scenario(): Promise<Scenario> {
    n += 1;
    const [org, mod, bianca, other, third, opponent] = ['org', 'mod', 'bia', 'oth', 'thr', 'opp'].map((k) => `${k}${n}`) as [string, string, string, string, string, string];
    await h.user(org, ['ORGANIZER', 'PARTICIPANT']);
    for (const k of [mod, bianca, other, third, opponent]) await h.user(k, ['PARTICIPANT']);
    const t = await h.tournament({ owner: org, game: cr, name: `Liga CR ${n}`, status: 'REGISTRATION_CLOSED', stages: [{ name: 'Mata-mata', format: 'SINGLE_ELIM', model: 'coroas', config: { bestOf: 3, thirdPlace: true }, tiebreakers: DUEL_TB, seeding: 'RANKED' }] });
    await h.staff(t.id, mod, 'MODERATOR', org);
    // Seeds pela ordem: 1 (Bianca) x 4 (adversário) e 2 x 3.
    const [mine, , , theirs] = await h.register(t.id, [{ user: bianca }, { user: other }, { user: third }, { user: opponent }]);
    const stageId = t.stageIds[0] as string;
    await h.call(org, `/stages/${stageId}/generate`, { method: 'POST', body: { seeding: 'RANKED' } });
    expect((await h.call(org, `/stages/${stageId}/confirm`, { method: 'POST' })).status).toBe(200);
    const bracket = Bracket.parse((await h.call(org, `/stages/${stageId}/bracket`)).data);
    const match = bracket.matches.find((m) => m.participants.some((p) => p.registrationId === mine)) as Match;
    expect(match.participants.some((p) => p.registrationId === theirs)).toBe(true);
    return { t, stageId, match, org, mod, bianca, opponent, other, mine: mine as string, theirs: theirs as string, print: await h.evidence(bianca) };
  }

  const payload = (s: Scenario, mineScore = 2, theirsScore = 1, evidenceUrls: string[] = [s.print]) => ({ entries: [{ registrationId: s.mine, score: mineScore }, { registrationId: s.theirs, score: theirsScore }], evidenceUrls });
  const submit = async (s: Scenario): Promise<ResultSubmission> => {
    const res = await h.call(s.bianca, `/matches/${s.match.id}/submissions`, { method: 'POST', body: payload(s) });
    expect(res.status, res.detail).toBe(201);
    return ResultSubmission.parse(res.data);
  };
  const standings = async (s: Scenario) => Standings.parse((await h.call(null, `/stages/${s.stageId}/standings`)).data).overall;
  const matchNow = async (id: string) => Match.parse((await h.call(null, `/matches/${id}`)).data);
  const submissionsOf = (s: Scenario) => h.db.resultSubmission.findMany({ where: { matchId: s.match.id } });
  const disputesOf = (s: Scenario) => h.db.dispute.findMany({ where: { matchId: s.match.id } });

  async function contest(s: Scenario): Promise<{ sub: ResultSubmission; dispute: Dispute; proof: string }> {
    const sub = await submit(s);
    const proof = await h.evidence(s.opponent);
    const res = await h.call(s.opponent, `/submissions/${sub.id}/dispute`, { method: 'POST', body: { reason: 'O placar real foi 2 a 1 para mim, não para ela.', evidenceUrls: [proof] } });
    expect(res.status, res.detail).toBe(201);
    return { sub, dispute: Dispute.parse(res.data), proof };
  }

  beforeAll(async () => {
    h = await createHarness(url as string, 'sb');
    await h.user('adm', ['ADMIN', 'PARTICIPANT']);
    await h.user('diego', ['ORGANIZER', 'PARTICIPANT']);
    await h.user('lucas', ['PARTICIPANT']);
    cr = await h.game('DUEL', [{ name: 'coroas', rules: SERIES_RULES }]);
  }, 120_000);
  afterAll(async () => {
    await h.db.siteSetting.deleteMany({ where: { key: 'flags' } });
    await h.db.$disconnect();
  });

  describe('envio de resultado pelo participante', () => {
    it('só quem joga a partida envia: visitante 401, outros 403', async () => {
      const s = await scenario();
      expect((await h.call(null, `/matches/${s.match.id}/submissions`, { method: 'POST', body: payload(s) })).status).toBe(401);
      for (const who of [s.org, 'adm', 'lucas', s.other, s.mod]) {
        expect((await h.call(who, `/matches/${s.match.id}/submissions`, { method: 'POST', body: payload(s) })).status, who).toBe(403);
      }
      expect(await submissionsOf(s)).toHaveLength(0);
    });

    it('sem print = 400; print de outra pessoa = 400', async () => {
      const s = await scenario();
      const res = await h.call(s.bianca, `/matches/${s.match.id}/submissions`, { method: 'POST', body: payload(s, 2, 1, []) });
      expect(res.status).toBe(400);
      expect(res.code).toBe('VALIDATION');
      expect((res.data as { errors?: Record<string, string> }).errors?.evidenceUrls).toMatch(/print/);
      const foreign = await h.call(s.bianca, `/matches/${s.match.id}/submissions`, { method: 'POST', body: payload(s, 2, 1, [await h.evidence(s.opponent)]) });
      expect(foreign.code).toBe('UPLOAD_NOT_FOUND');
      expect(await submissionsOf(s)).toHaveLength(0);
    });

    it('placar inválido para a série (MD3) = 400, sem gravar nada', async () => {
      const s = await scenario();
      expect((await h.call(s.bianca, `/matches/${s.match.id}/submissions`, { method: 'POST', body: payload(s, 3, 1) })).status).toBe(400);
      expect((await h.call(s.bianca, `/matches/${s.match.id}/submissions`, { method: 'POST', body: payload(s, 1, 1) })).code).toBe('DRAW_NOT_ALLOWED');
      const oneSide = await h.call(s.bianca, `/matches/${s.match.id}/submissions`, { method: 'POST', body: { entries: [{ registrationId: s.mine, score: 2 }], evidenceUrls: [s.print] } });
      expect(oneSide.code).toBe('INVALID_RESULT');
      expect(await submissionsOf(s)).toHaveLength(0);
      expect((await matchNow(s.match.id)).status).toBe(s.match.status);
    });

    it('queda de Battle Royale = 400: quem lança é a organização', async () => {
      const ff = await h.game('BATTLE_ROYALE', [{ name: 'padrao', rules: [{ type: 'PER_UNIT', stat: 'kills', points: 1 }] }]);
      await h.user('brorg', ['ORGANIZER']);
      await h.user('brjog', ['PARTICIPANT']);
      const t = await h.tournament({ owner: 'brorg', game: ff, stages: [{ name: 'Quedas', format: 'BATTLE_ROYALE', model: 'padrao', config: { drops: 1 } }] });
      const [reg] = await h.register(t.id, [{ user: 'brjog' }, { name: 'Outro squad' }]);
      await h.call('brorg', `/stages/${t.stageIds[0]}/generate`, { method: 'POST', body: { seeding: 'RANKED' } });
      await h.call('brorg', `/stages/${t.stageIds[0]}/confirm`, { method: 'POST' });
      const drop = Bracket.parse((await h.call('brorg', `/stages/${t.stageIds[0]}/bracket`)).data).matches[0] as Match;
      const res = await h.call('brjog', `/matches/${drop.id}/submissions`, { method: 'POST', body: { entries: [{ registrationId: reg, placement: 1, kills: 9 }], evidenceUrls: [await h.evidence('brjog')] } });
      expect(res.status).toBe(400);
      expect(res.code).toBe('LOBBY_RESULT_BY_STAFF');
      expect(res.detail).toMatch(/organização/);
    });

    it('marca a partida como aguardando validação, avisa o adversário e não aceita segundo envio', async () => {
      const s = await scenario();
      const before = await standings(s);
      const sub = await submit(s);
      expect(sub).toMatchObject({ status: 'PENDING', submittedByRegistrationId: s.mine, winnerRegistrationId: s.mine, evidenceUrls: [s.print], tournamentId: s.t.id });
      expect(sub.submittedByNickname).toContain(`sbbia${n}`);
      expect(new Date(sub.respondBy).getTime() - new Date(sub.createdAt).getTime()).toBe(30 * 60_000);
      expect((await matchNow(s.match.id)).status).toBe('AWAITING_VALIDATION');
      expect(await h.notificationsOf(s.opponent)).toContain('Confirme o resultado da sua partida');
      // Envio pendente não conta na tabela.
      expect(await standings(s)).toEqual(before);
      // A prova fica ligada à partida (não é apagada como órfã) e é privada.
      expect(await h.db.upload.findFirst({ where: { id: s.print.split('/').at(-1) } })).toMatchObject({ attachedType: 'MATCH', attachedId: s.match.id });

      const again = await h.call(s.bianca, `/matches/${s.match.id}/submissions`, { method: 'POST', body: payload(s, 2, 1, [await h.evidence(s.bianca)]) });
      expect(again.status).toBe(409);
      expect(again.code).toBe('SUBMISSION_EXISTS');
      expect((await h.call(s.opponent, `/matches/${s.match.id}/submissions`, { method: 'POST', body: payload(s, 0, 2, [await h.evidence(s.opponent)]) })).code).toBe('SUBMISSION_EXISTS');
    });

    it('com a flag `resultSubmission` desligada, o envio é recusado (403)', async () => {
      const s = await scenario();
      await h.db.siteSetting.upsert({ where: { key: 'flags' }, create: { key: 'flags', value: { resultSubmission: false } }, update: { value: { resultSubmission: false } } });
      try {
        const res = await h.call(s.bianca, `/matches/${s.match.id}/submissions`, { method: 'POST', body: payload(s) });
        expect(res.status).toBe(403);
        expect(res.code).toBe('FEATURE_DISABLED');
      } finally {
        await h.db.siteSetting.deleteMany({ where: { key: 'flags' } });
      }
      expect((await h.call(s.bianca, `/matches/${s.match.id}/submissions`, { method: 'POST', body: payload(s) })).status).toBe(201);
    });

    it('o envio ativo é visível aos dois lados e ao staff, e a mais ninguém', async () => {
      const s = await scenario();
      expect((await h.call(s.bianca, `/matches/${s.match.id}/submission`)).data).toBeNull();
      const sub = await submit(s);
      for (const who of [s.bianca, s.opponent, s.org, s.mod, 'adm']) {
        const res = await h.call(who, `/matches/${s.match.id}/submission`);
        expect(res.status, who).toBe(200);
        expect(ResultSubmission.parse(res.data).id).toBe(sub.id);
        expect((await h.call(who, `/submissions/${sub.id}`)).status).toBe(200);
      }
      expect((await h.call('diego', `/matches/${s.match.id}/submission`)).status).toBe(403);
      expect((await h.call('diego', `/submissions/${sub.id}`)).status).toBe(403);
      expect((await h.call(null, `/matches/${s.match.id}/submission`)).status).toBe(401);
    });
  });

  describe('confirmação do adversário e validação do staff', () => {
    it('quem enviou não confirma o próprio envio; só o adversário responde', async () => {
      const s = await scenario();
      const sub = await submit(s);
      const own = await h.call(s.bianca, `/submissions/${sub.id}/confirm`, { method: 'POST' });
      expect(own.status).toBe(403);
      expect(own.detail).toMatch(/próprio envio/);
      expect((await h.call(s.bianca, `/submissions/${sub.id}/dispute`, { method: 'POST', body: { reason: 'Quero contestar o meu próprio envio', evidenceUrls: [s.print] } })).status).toBe(403);
      for (const who of [s.org, 'adm', 'lucas']) expect((await h.call(who, `/submissions/${sub.id}/confirm`, { method: 'POST' })).status, who).toBe(403);
      expect((await submissionsOf(s))[0]?.status).toBe('PENDING');
    });

    it('adversário confirma → staff aprova → partida VALIDATED com pontos calculados pelo servidor', async () => {
      const s = await scenario();
      const before = await standings(s);
      const sub = await submit(s);
      // Antes da resposta e dentro do prazo, o envio não está na fila nem pode ser aprovado.
      expect(Submissions.parse((await h.call(s.org, `/tournaments/${s.t.id}/submissions`)).data)).toEqual([]);
      expect((await h.call(s.org, `/submissions/${sub.id}`, { method: 'PATCH', body: { action: 'approve' } })).code).toBe('SUBMISSION_AWAITING_OPPONENT');

      const confirmed = await h.call(s.opponent, `/submissions/${sub.id}/confirm`, { method: 'POST' });
      expect(confirmed.status).toBe(200);
      expect(ResultSubmission.parse(confirmed.data).status).toBe('CONFIRMED');
      expect((await h.call(s.opponent, `/submissions/${sub.id}/confirm`, { method: 'POST' })).code).toBe('SUBMISSION_NOT_PENDING');
      // Confirmado ainda não é oficial.
      expect(await standings(s)).toEqual(before);
      expect((await matchNow(s.match.id)).status).toBe('AWAITING_VALIDATION');
      expect(await h.notificationsOf(s.org)).toContain('Resultado para validar');

      // Só o staff do campeonato valida.
      for (const who of [s.bianca, s.opponent, 'diego']) {
        expect((await h.call(who, `/tournaments/${s.t.id}/submissions`)).status, who).toBe(403);
        expect((await h.call(who, `/submissions/${sub.id}`, { method: 'PATCH', body: { action: 'approve' } })).status, who).toBe(403);
      }
      expect((await h.call(null, `/tournaments/${s.t.id}/submissions`)).status).toBe(401);
      expect((await h.call(s.org, `/tournaments/${s.t.id}/submissions?status=XYZ`)).code).toBe('INVALID_STATUS');

      const queue = Submissions.parse((await h.call(s.org, `/tournaments/${s.t.id}/submissions`)).data);
      expect(queue.map((x) => x.id)).toEqual([sub.id]);
      const approved = await h.call(s.org, `/submissions/${sub.id}`, { method: 'PATCH', body: { action: 'approve' } });
      expect(approved.status, approved.detail).toBe(200);
      expect(ResultSubmission.parse(approved.data).status).toBe('APPROVED');

      const match = await matchNow(s.match.id);
      expect(match.status).toBe('VALIDATED');
      expect(match.evidenceUrls).toEqual([s.print]);
      // Modelo "Coroas + vitória": 1 por coroa + 3 pela vitória. O cliente nunca mandou pontos.
      expect(match.participants.find((p) => p.registrationId === s.mine)).toMatchObject({ score: 2, points: 5, isWinner: true });
      expect(match.participants.find((p) => p.registrationId === s.theirs)).toMatchObject({ score: 1, points: 1, isWinner: false });
      const after = await standings(s);
      expect(after).not.toEqual(before);
      expect(after.find((r) => r.registrationId === s.mine)?.wins).toBe((before.find((r) => r.registrationId === s.mine)?.wins ?? 0) + 1);
      expect((await h.db.auditLog.findFirstOrThrow({ where: { action: 'RESULT_ENTERED', entityId: s.match.id } })).after).toMatchObject({ origem: 'SUBMISSION' });

      expect(Submissions.parse((await h.call(s.org, `/tournaments/${s.t.id}/submissions`)).data)).toEqual([]);
      expect((await h.call(s.org, `/submissions/${sub.id}`, { method: 'PATCH', body: { action: 'approve' } })).code).toBe('SUBMISSION_REVIEWED');
      expect((await h.call(s.bianca, `/matches/${s.match.id}/submission`)).data).toBeNull();
    });

    it('pendente com o prazo vencido entra na fila e pode ser aprovado sem a resposta do adversário', async () => {
      const s = await scenario();
      const sub = await submit(s);
      const real = h.clock.now;
      h.clock.now = new Date(real.getTime() + 31 * 60_000);
      try {
        expect(Submissions.parse((await h.call(s.org, `/tournaments/${s.t.id}/submissions`)).data).map((x) => x.id)).toEqual([sub.id]);
        expect((await h.call(s.org, `/submissions/${sub.id}`, { method: 'PATCH', body: { action: 'approve' } })).status).toBe(200);
      } finally {
        h.clock.now = real;
      }
      expect((await matchNow(s.match.id)).status).toBe('VALIDATED');
    });

    it('recusar exige motivo, devolve a partida ao estado normal e libera novo envio', async () => {
      const s = await scenario();
      const before = await standings(s);
      const sub = await submit(s);
      expect((await h.call(s.org, `/submissions/${sub.id}`, { method: 'PATCH', body: { action: 'reject' } })).code).toBe('VALIDATION');
      const rejected = await h.call(s.org, `/submissions/${sub.id}`, { method: 'PATCH', body: { action: 'reject', reason: 'O print não mostra o placar final.' } });
      expect(rejected.status).toBe(200);
      expect(ResultSubmission.parse(rejected.data).status).toBe('REJECTED');
      expect((await submissionsOf(s))[0]).toMatchObject({ rejectReason: 'O print não mostra o placar final.', reviewedById: h.id(s.org) });
      expect((await matchNow(s.match.id)).status).toBe(s.match.status);
      expect(await standings(s)).toEqual(before);
      expect(await h.notificationsOf(s.bianca)).toContain('Seu envio de resultado foi recusado');
      expect(await h.auditCount({ action: 'SUBMISSION_REJECTED', entityId: s.match.id })).toBe(1);
      expect((await h.call(s.opponent, `/matches/${s.match.id}/submissions`, { method: 'POST', body: payload(s, 0, 2, [await h.evidence(s.opponent)]) })).status).toBe(201);
    });

    it('moderador do campeonato também valida', async () => {
      const s = await scenario();
      const sub = await submit(s);
      await h.call(s.opponent, `/submissions/${sub.id}/confirm`, { method: 'POST' });
      expect((await h.call(s.mod, `/tournaments/${s.t.id}/submissions`)).status).toBe(200);
      expect((await h.call(s.mod, `/submissions/${sub.id}`, { method: 'PATCH', body: { action: 'approve' } })).status).toBe(200);
    });
  });

  describe('contestação e disputa', () => {
    it('contestar sem prova = 400', async () => {
      const s = await scenario();
      const sub = await submit(s);
      const res = await h.call(s.opponent, `/submissions/${sub.id}/dispute`, { method: 'POST', body: { reason: 'O placar real foi outro, tenho certeza.', evidenceUrls: [] } });
      expect(res.status).toBe(400);
      expect((res.data as { errors?: Record<string, string> }).errors?.evidenceUrls).toMatch(/prova/);
      expect((await h.call(s.opponent, `/submissions/${sub.id}/dispute`, { method: 'POST', body: { reason: 'curto', evidenceUrls: [await h.evidence(s.opponent)] } })).status).toBe(400);
      expect(await disputesOf(s)).toHaveLength(0);
      expect((await submissionsOf(s))[0]?.status).toBe('PENDING');
    });

    it('contestação: a tabela não muda até a disputa ser resolvida', async () => {
      const s = await scenario();
      const before = await standings(s);
      const { sub, dispute, proof } = await contest(s);
      expect(dispute).toMatchObject({ status: 'OPEN', submissionId: sub.id, matchId: s.match.id, resolution: null, resolvedAt: null });
      expect(dispute.messages).toHaveLength(1);
      expect(dispute.messages[0]).toMatchObject({ authorRole: 'PARTICIPANT', evidenceUrls: [proof] });
      expect((await submissionsOf(s))[0]?.status).toBe('CONTESTED');
      expect((await matchNow(s.match.id)).status).toBe('DISPUTED');
      expect(await standings(s)).toEqual(before);
      expect(await h.notificationsOf(s.bianca)).toContain('Seu resultado foi contestado');
      expect(await h.notificationsOf(s.org)).toContain('Nova disputa para analisar');

      // Contestado não pode ser confirmado nem aprovado pela fila: só pela disputa.
      expect((await h.call(s.opponent, `/submissions/${sub.id}/confirm`, { method: 'POST' })).code).toBe('SUBMISSION_NOT_PENDING');
      expect((await h.call(s.org, `/submissions/${sub.id}`, { method: 'PATCH', body: { action: 'approve' } })).code).toBe('SUBMISSION_CONTESTED');
      expect(Submissions.parse((await h.call(s.org, `/tournaments/${s.t.id}/submissions`)).data)).toEqual([]);
      expect(await standings(s)).toEqual(before);

      // Mensagens e escalonamento também não mexem na tabela.
      expect((await h.call(s.org, `/disputes/${dispute.id}/messages`, { method: 'POST', body: { body: 'Vou conferir os dois prints.' } })).status).toBe(201);
      expect((await h.call(s.org, `/disputes/${dispute.id}/escalate`, { method: 'POST' })).status).toBe(200);
      expect(await standings(s)).toEqual(before);
      expect((await matchNow(s.match.id)).status).toBe('DISPUTED');

      // Resolvida com o resultado correto: agora sim a tabela muda.
      const resolved = await h.call('adm', `/disputes/${dispute.id}/resolve`, { method: 'POST', body: { resolution: 'Print do adversário confere com a transmissão.', result: { entries: [{ registrationId: s.mine, score: 1 }, { registrationId: s.theirs, score: 2 }] } } });
      expect(resolved.status, resolved.detail).toBe(200);
      const after = await standings(s);
      expect(after).not.toEqual(before);
      expect(after.find((r) => r.registrationId === s.theirs)?.wins).toBe((before.find((r) => r.registrationId === s.theirs)?.wins ?? 0) + 1);
    });

    it('acesso: envolvidos, staff e Admin veem a disputa; os outros não', async () => {
      const s = await scenario();
      const { dispute } = await contest(s);
      for (const who of [s.bianca, s.opponent, s.org, s.mod, 'adm']) expect((await h.call(who, `/disputes/${dispute.id}`)).status, who).toBe(200);
      for (const who of ['diego', 'lucas', s.other]) {
        expect((await h.call(who, `/disputes/${dispute.id}`)).status, who).toBe(403);
        expect((await h.call(who, `/disputes/${dispute.id}/messages`, { method: 'POST', body: { body: 'Intrometido' } })).status, who).toBe(403);
      }
      expect((await h.call(null, `/disputes/${dispute.id}`)).status).toBe(401);
      expect((await h.call('adm', `/disputes/00000000-0000-0000-0000-000000000000`)).status).toBe(404);

      expect(Disputes.parse((await h.call(s.bianca, '/me/disputes')).data).map((d) => d.id)).toEqual([dispute.id]);
      expect((await h.call(s.bianca, `/tournaments/${s.t.id}/disputes`)).status).toBe(403);
      expect(Disputes.parse((await h.call(s.opponent, '/me/disputes')).data).map((d) => d.id)).toEqual([dispute.id]);
      expect(Disputes.parse((await h.call('diego', '/me/disputes')).data)).toEqual([]);
      expect((await h.call(null, '/me/disputes')).status).toBe(401);
      expect(Disputes.parse((await h.call(s.org, `/tournaments/${s.t.id}/disputes`)).data).map((d) => d.id)).toEqual([dispute.id]);
      expect(Disputes.parse((await h.call(s.mod, `/tournaments/${s.t.id}/disputes?status=RESOLVED`)).data)).toEqual([]);
      expect((await h.call('diego', `/tournaments/${s.t.id}/disputes`)).status).toBe(403);
    });

    it('mensagens: papel do autor, anexos e aviso aos outros envolvidos', async () => {
      const s = await scenario();
      const { dispute } = await contest(s);
      const mine = await h.call(s.bianca, `/disputes/${dispute.id}/messages`, { method: 'POST', body: { body: 'Segue o print do fim da partida.', evidenceUrls: [await h.evidence(s.bianca)] } });
      expect(mine.status, mine.detail).toBe(201);
      const hers = Dispute.parse((await h.call(s.org, `/disputes/${dispute.id}/messages`, { method: 'POST', body: { body: 'Recebido, vou analisar.' } })).data);
      expect(hers.messages.map((m) => [m.authorRole, m.evidenceUrls.length])).toEqual([
        ['PARTICIPANT', 1],
        ['PARTICIPANT', 1],
        ['STAFF', 0],
      ]);
      expect(hers.messages[1]?.authorNickname).toContain(`sbbia${n}`);
      expect((await h.call(s.org, `/disputes/${dispute.id}/messages`, { method: 'POST', body: { body: '' } })).code).toBe('VALIDATION');
      expect((await h.notificationsOf(s.opponent)).filter((t) => t === 'Nova mensagem na disputa')).toHaveLength(2);
      // Quem escreveu não é avisado da própria mensagem.
      expect((await h.notificationsOf(s.org)).filter((t) => t === 'Nova mensagem na disputa')).toHaveLength(1);
      expect((await h.call('adm', `/disputes/${dispute.id}/messages`, { method: 'POST', body: { body: 'Olhando também.' } })).status).toBe(201);
      expect(Dispute.parse((await h.call('adm', `/disputes/${dispute.id}`)).data).messages.at(-1)?.authorRole).toBe('ADMIN');
    });

    it('staff resolve mantendo o resultado enviado: envio aprovado, partida validada, auditoria', async () => {
      const s = await scenario();
      const { sub, dispute } = await contest(s);
      for (const who of [s.bianca, s.opponent, 'diego']) {
        expect((await h.call(who, `/disputes/${dispute.id}/resolve`, { method: 'POST', body: { resolution: 'Eu decido!' } })).status, who).toBe(403);
        expect((await h.call(who, `/disputes/${dispute.id}/escalate`, { method: 'POST' })).status, who).toBe(403);
      }
      expect((await h.call(s.org, `/disputes/${dispute.id}/resolve`, { method: 'POST', body: { resolution: 'ok' } })).code).toBe('VALIDATION');
      const res = await h.call(s.org, `/disputes/${dispute.id}/resolve`, { method: 'POST', body: { resolution: 'O print da Bianca mostra o placar final.', result: payload(s, 2, 1, []) } });
      expect(res.status, res.detail).toBe(200);
      const resolved = Dispute.parse(res.data);
      expect(resolved).toMatchObject({ status: 'RESOLVED', resolution: 'O print da Bianca mostra o placar final.' });
      expect(resolved.resolvedAt).not.toBeNull();
      expect((await h.db.resultSubmission.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe('APPROVED');
      const match = await matchNow(s.match.id);
      expect(match.status).toBe('VALIDATED');
      // Sem prova nova na resolução, a partida fica com o print do envio original.
      expect(match.evidenceUrls).toEqual([s.print]);
      expect(match.participants.find((p) => p.registrationId === s.mine)).toMatchObject({ points: 5, isWinner: true });
      const log = await h.db.auditLog.findFirstOrThrow({ where: { action: 'DISPUTE_RESOLVED', entityId: dispute.id } });
      expect(log).toMatchObject({ actorId: h.id(s.org), entityType: 'Dispute', tournamentId: s.t.id, before: { status: 'OPEN' }, after: { status: 'RESOLVED', resultadoLancado: true } });
      expect(await h.notificationsOf(s.bianca)).toContain('Disputa resolvida');
      expect(await h.notificationsOf(s.opponent)).toContain('Disputa resolvida');

      // Encerrada: não resolve de novo, não escala e não recebe mensagem.
      expect((await h.call(s.org, `/disputes/${dispute.id}/resolve`, { method: 'POST', body: { resolution: 'De novo, por favor' } })).status).toBe(409);
      expect((await h.call(s.org, `/disputes/${dispute.id}/escalate`, { method: 'POST' })).status).toBe(409);
      expect((await h.call(s.org, `/disputes/${dispute.id}/messages`, { method: 'POST', body: { body: 'Mais uma coisa' } })).code).toBe('DISPUTE_CLOSED');
    });

    it('resolver sem resultado anula o envio e a partida volta a aceitar resultado', async () => {
      const s = await scenario();
      const before = await standings(s);
      const { sub, dispute } = await contest(s);
      expect((await h.call(s.mod, `/disputes/${dispute.id}/resolve`, { method: 'POST', body: { resolution: 'Nenhum dos prints é conclusivo: joguem de novo.' } })).status).toBe(200);
      expect((await h.db.resultSubmission.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe('REJECTED');
      expect((await matchNow(s.match.id)).status).toBe(s.match.status);
      expect((await h.db.match.findUniqueOrThrow({ where: { id: s.match.id } })).status).toBe('SCHEDULED');
      expect(await standings(s)).toEqual(before);
      expect((await h.db.auditLog.findFirstOrThrow({ where: { action: 'DISPUTE_RESOLVED', entityId: dispute.id } })).after).toMatchObject({ resultadoLancado: false });
      expect((await h.call(s.bianca, `/matches/${s.match.id}/submissions`, { method: 'POST', body: payload(s, 2, 1, [await h.evidence(s.bianca)]) })).status).toBe(201);
    });

    it('escalar e resolver com resultado corrigido grava auditoria; escalada só o Admin resolve', async () => {
      const s = await scenario();
      const { sub, dispute, proof } = await contest(s);
      const escalated = await h.call(s.org, `/disputes/${dispute.id}/escalate`, { method: 'POST' });
      expect(escalated.status).toBe(200);
      expect(Dispute.parse(escalated.data).status).toBe('ESCALATED');
      expect(await h.db.dispute.findUniqueOrThrow({ where: { id: dispute.id } })).toMatchObject({ escalatedById: h.id(s.org) });
      expect(await h.notificationsOf('adm')).toContain('Disputa escalada para análise');
      expect(await h.notificationsOf(s.bianca)).toContain('Disputa escalada para a administração');
      expect((await h.call(s.org, `/disputes/${dispute.id}/escalate`, { method: 'POST' })).code).toBe('DISPUTE_NOT_OPEN');
      expect(await h.auditCount({ action: 'DISPUTE_ESCALATED', entityId: dispute.id })).toBe(1);

      // Escalada: a organização do campeonato não resolve mais.
      expect((await h.call(s.org, `/disputes/${dispute.id}/resolve`, { method: 'POST', body: { resolution: 'Decido eu mesma.' } })).status).toBe(403);
      expect((await h.db.dispute.findUniqueOrThrow({ where: { id: dispute.id } })).status).toBe('ESCALATED');

      const corrected = { entries: [{ registrationId: s.mine, score: 0 }, { registrationId: s.theirs, score: 2 }], evidenceUrls: [proof] };
      const res = await h.call('adm', `/disputes/${dispute.id}/resolve`, { method: 'POST', body: { resolution: 'A prova do adversário mostra 2 a 0. Resultado corrigido.', result: corrected } });
      expect(res.status, res.detail).toBe(200);
      expect(Dispute.parse(res.data).status).toBe('RESOLVED');
      // O resultado oficial é o corrigido, não o que foi enviado.
      const match = await matchNow(s.match.id);
      expect(match.status).toBe('VALIDATED');
      expect(match.evidenceUrls).toEqual([proof]);
      expect(match.participants.find((p) => p.registrationId === s.theirs)).toMatchObject({ score: 2, points: 5, isWinner: true });
      expect(match.participants.find((p) => p.registrationId === s.mine)).toMatchObject({ score: 0, points: 0, isWinner: false });
      expect((await h.db.resultSubmission.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe('REJECTED');
      expect(await h.db.auditLog.findFirstOrThrow({ where: { action: 'DISPUTE_RESOLVED', entityId: dispute.id } })).toMatchObject({ actorId: h.id('adm'), before: { status: 'ESCALATED' }, after: { status: 'RESOLVED', resultadoLancado: true }, reason: 'A prova do adversário mostra 2 a 0. Resultado corrigido.' });
      const entered = await h.db.auditLog.findFirstOrThrow({ where: { action: 'RESULT_ENTERED', entityId: s.match.id } });
      expect(entered).toMatchObject({ actorId: h.id('adm'), after: { origem: 'DISPUTE' } });
      // A linha do tempo da disputa mostra o lançamento.
      const events = (await h.call(s.bianca, `/matches/${s.match.id}/events`)).data as { type: string }[];
      expect(events.map((e) => e.type)).toEqual(['ENTERED']);
    });
  });
});
