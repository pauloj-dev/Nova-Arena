/**
 * Chat por partida (issue 125) contra um Postgres de verdade (`TEST_DATABASE_URL`): rotas × papéis (visitante,
 * jogador da partida, jogador de outra partida, organizador, moderador, Admin), limite de tamanho e de envio, ocultar,
 * denúncia da mensagem e o evento `chat.updated` no canal `match:{id}`.
 */
import { AdminReport, Match, MatchChat, MatchChatMessage, Report } from '@nova/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createHarness, SERIES_RULES, type Harness } from './fixtures/arena';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('chat por partida (Postgres)', () => {
  let h: Harness;
  let tournamentId = '';
  let mine: Match;
  let other: Match;
  const path = () => `/matches/${mine.id}/chat`;

  beforeAll(async () => {
    h = await createHarness(url as string, 'chat');
    await h.user('dono', ['ORGANIZER', 'PARTICIPANT']);
    await h.user('mod');
    await h.user('admin', ['ADMIN']);
    await h.user('a');
    await h.user('b');
    await h.user('c');
    await h.user('d');
    await h.user('fora');
    const cr = await h.game('DUEL', [{ name: 'coroas', rules: SERIES_RULES }]);
    const t = await h.tournament({ owner: 'dono', game: cr, stages: [{ name: 'Mata-mata', format: 'SINGLE_ELIM', model: 'coroas', seeding: 'RANKED' }] });
    tournamentId = t.id;
    await h.staff(t.id, 'mod', 'MODERATOR', 'dono');
    await h.register(t.id, [{ user: 'a' }, { user: 'b' }, { user: 'c' }, { user: 'd' }]);
    const sid = t.stageIds[0] as string;
    expect((await h.call('dono', `/stages/${sid}/generate`, { method: 'POST', body: { seeding: 'RANKED' } })).status).toBe(200);
    expect((await h.call('dono', `/stages/${sid}/confirm`, { method: 'POST' })).status).toBe(200);
    const matches = z.array(Match).parse((await h.call('dono', `/tournaments/${t.id}/matches`)).data).filter((m) => m.round === 1);
    const regA = (await h.db.registration.findFirstOrThrow({ where: { tournamentId: t.id, userId: h.id('a') } })).id;
    mine = matches.find((m) => m.participants.some((p) => p.registrationId === regA)) as Match;
    other = matches.find((m) => m.id !== mine.id) as Match;
    expect(mine && other).toBeTruthy();
  });

  afterAll(async () => {
    await h?.db.$disconnect();
  });

  /** As duas pessoas da partida da jogadora `a`. */
  async function playersOfMine(): Promise<string[]> {
    const regs = await h.db.registration.findMany({ where: { id: { in: mine.participants.map((p) => p.registrationId as string) } }, select: { userId: true } });
    const keys = ['a', 'b', 'c', 'd'];
    return keys.filter((k) => regs.some((r) => r.userId === h.id(k)));
  }

  it('visitante 401; quem não é da partida 403; partida inexistente 404', async () => {
    expect((await h.call(null, path())).status).toBe(401);
    expect((await h.call('fora', path())).code).toBe('FORBIDDEN');
    const outsider = (await playersOfMine()).includes('c') ? 'd' : 'c';
    const res = await h.call(outsider, path());
    expect(res.status).toBe(403);
    expect((await h.call('a', '/matches/00000000-0000-4000-8000-000000000000/chat')).status).toBe(404);
  });

  it('jogadores da partida, organizador, moderador e Admin leem e escrevem; o canal da partida é avisado', async () => {
    const [p1, p2] = await playersOfMine();
    for (const who of [p1, p2, 'dono', 'mod', 'admin'] as string[]) {
      const res = await h.call(who, path());
      expect(res.status, who).toBe(200);
      const chat = MatchChat.parse(res.data);
      expect(chat.canPost, who).toBe(true);
      expect(chat.canModerate, who).toBe(who === 'dono' || who === 'mod' || who === 'admin');
    }
    const before = h.realtime.events.length;
    const sent = await h.call(p1 as string, path(), { method: 'POST', body: { body: '  Bora jogar às 20h? Sala no privado.  ' } });
    expect(sent.status).toBe(201);
    const message = MatchChatMessage.parse(sent.data);
    h.clock.now = new Date(h.clock.now.getTime() + 1000);
    expect(message).toMatchObject({ body: 'Bora jogar às 20h? Sala no privado.', authorRole: 'PLAYER', hidden: false });
    const staffMsg = MatchChatMessage.parse((await h.call('mod', path(), { method: 'POST', body: { body: 'Combinado, a sala sai 15 min antes.' } })).data);
    expect(staffMsg.authorRole).toBe('STAFF');
    // O evento só diz que mudou (sem o texto), no canal da partida.
    const events = h.realtime.events.slice(before);
    expect(events).toEqual([
      { channel: `match:${mine.id}`, event: { type: 'chat.updated', matchId: mine.id } },
      { channel: `match:${mine.id}`, event: { type: 'chat.updated', matchId: mine.id } },
    ]);
    const list = MatchChat.parse((await h.call(p2 as string, path())).data);
    expect(list.messages.map((m) => m.body)).toEqual(['Bora jogar às 20h? Sala no privado.', 'Combinado, a sala sai 15 min antes.']);
    // O chat de outra partida não mistura.
    const otherPlayer = (await playersOfMine()).includes('c') ? 'd' : 'c';
    expect(MatchChat.parse((await h.call(otherPlayer, `/matches/${other.id}/chat`)).data).messages).toEqual([]);
  });

  it('mensagem vazia ou longa demais: 400 com o erro no campo', async () => {
    const [p1] = await playersOfMine();
    const empty = await h.call(p1 as string, path(), { method: 'POST', body: { body: '   ' } });
    expect(empty.status).toBe(400);
    const long = await h.call(p1 as string, path(), { method: 'POST', body: { body: 'x'.repeat(501) } });
    expect(long.status).toBe(400);
    expect((long.data as { errors?: Record<string, string> }).errors?.body).toMatch(/500/);
  });

  it('limite de envio: 5 mensagens a cada 30 s por pessoa na partida (429 RATE_LIMITED)', async () => {
    const [, p2] = await playersOfMine();
    for (let i = 0; i < 5; i++) expect((await h.call(p2 as string, path(), { method: 'POST', body: { body: `msg ${i}` } })).status).toBe(201);
    const blocked = await h.call(p2 as string, path(), { method: 'POST', body: { body: 'mais uma' } });
    expect(blocked.status).toBe(429);
    expect(blocked.code).toBe('RATE_LIMITED');
    // Passou a janela: volta a enviar.
    h.clock.now = new Date(h.clock.now.getTime() + 31_000);
    expect((await h.call(p2 as string, path(), { method: 'POST', body: { body: 'depois da janela' } })).status).toBe(201);
  });

  it('ocultar: o jogador só a própria; a organização qualquer uma; jogador não vê o texto ocultado, a organização vê', async () => {
    const [p1, p2] = await playersOfMine();
    const target = MatchChatMessage.parse((await h.call(p1 as string, path(), { method: 'POST', body: { body: 'mensagem ofensiva' } })).data);
    expect((await h.call(p2 as string, `${path()}/${target.id}`, { method: 'DELETE' })).status).toBe(403);
    const hidden = await h.call('mod', `${path()}/${target.id}`, { method: 'DELETE' });
    expect(hidden.status).toBe(200);
    expect(MatchChatMessage.parse(hidden.data)).toMatchObject({ hidden: true, body: 'mensagem ofensiva' });
    const asPlayer = MatchChat.parse((await h.call(p2 as string, path())).data).messages.find((m) => m.id === target.id);
    expect(asPlayer).toMatchObject({ hidden: true, body: '' });
    const asStaff = MatchChat.parse((await h.call('dono', path())).data).messages.find((m) => m.id === target.id);
    expect(asStaff).toMatchObject({ hidden: true, body: 'mensagem ofensiva' });
    // O próprio autor apaga a sua.
    const own = MatchChatMessage.parse((await h.call(p2 as string, path(), { method: 'POST', body: { body: 'errei a sala' } })).data);
    expect((await h.call(p2 as string, `${path()}/${own.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await h.call(p2 as string, `${path()}/00000000-0000-4000-8000-000000000000`, { method: 'DELETE' })).status).toBe(404);
  });

  it('denúncia da mensagem: quem está no chat denuncia; quem não está, não; a moderação vê o texto', async () => {
    const [p1, p2] = await playersOfMine();
    const msg = MatchChatMessage.parse((await h.call(p1 as string, path(), { method: 'POST', body: { body: 'você é horrível' } })).data);
    const input = { targetType: 'CHAT_MESSAGE', targetId: msg.id, reason: 'HARASSMENT', description: 'Ofensa no chat da partida das quartas.', evidenceUrls: [] };
    expect((await h.call('fora', '/reports', { method: 'POST', body: input })).status).toBe(404);
    expect((await h.call(p1 as string, '/reports', { method: 'POST', body: input })).code).toBe('REPORT_SELF');
    const created = await h.call(p2 as string, '/reports', { method: 'POST', body: input });
    expect(created.status).toBe(201);
    const report = Report.parse(created.data);
    expect(report.targetType).toBe('CHAT_MESSAGE');
    expect(report.targetLabel).toContain('você é horrível');
    const row = await h.db.report.findUniqueOrThrow({ where: { id: report.id } });
    expect(row.targetOwnerUserId).toBe(h.id(p1 as string));
    expect(AdminReport.shape.targetType.options).toContain('CHAT_MESSAGE');
  });

  it('campeonato encerrado: o chat fica só para leitura (409 CHAT_CLOSED ao escrever)', async () => {
    const [p1] = await playersOfMine();
    await h.db.tournament.update({ where: { id: tournamentId }, data: { status: 'FINISHED' } });
    const chat = MatchChat.parse((await h.call(p1 as string, path())).data);
    expect(chat.canPost).toBe(false);
    expect(chat.closedReason).toMatch(/só para leitura/);
    expect((await h.call(p1 as string, path(), { method: 'POST', body: { body: 'oi' } })).code).toBe('CHAT_CLOSED');
    await h.db.tournament.update({ where: { id: tournamentId }, data: { status: 'IN_PROGRESS' } });
  });
});
