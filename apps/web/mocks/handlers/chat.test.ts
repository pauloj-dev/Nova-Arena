import { MatchChat, MatchChatMessage, type Match } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { db } from '../db';
import { as, call, setupMockApi } from '../testing';

setupMockApi();

const BIANCA = 'u_bianca';
const LIGA = 'liga-semanal-clash-royale';

/** A partida da Bianca nas quartas (seed), o adversário e alguém da liga que não está nela. */
async function scenario() {
  as(BIANCA);
  const matches = (await call<Match[]>('GET', `/tournaments/${LIGA}/matches?mine=1`)).data;
  const match = matches.find((m) => m.status !== 'VALIDATED' && m.participants.every((p) => p.registrationId)) as Match;
  const t = db().tournaments.find((x) => x.slug === LIGA);
  if (!match || !t) throw new Error('seed sem a partida da Bianca');
  const regOf = (id: string | null) => db().registrations.find((r) => r.id === id);
  const opponent = match.participants.map((p) => regOf(p.registrationId)?.userId).find((u) => u && u !== BIANCA) as string;
  const outsider = db().registrations.find((r) => r.tournamentId === t.id && r.status === 'CONFIRMED' && r.userId && !match.participants.some((p) => p.registrationId === r.id))?.userId as string;
  return { match, owner: t.ownerId, opponent, outsider, path: `/matches/${match.id}/chat` };
}

describe('chat por partida na API simulada (mesmas regras da real)', () => {
  it('visitante 401, quem não está na partida 403; jogadores e organização leem e escrevem', async () => {
    const s = await scenario();
    as(null);
    expect((await call('GET', s.path)).status).toBe(401);
    as(s.outsider);
    expect((await call('GET', s.path)).status).toBe(403);

    as(BIANCA);
    const sent = await call('POST', s.path, { body: ' Bora às 20h? ' });
    expect(sent.status).toBe(201);
    expect(MatchChatMessage.parse(sent.data)).toMatchObject({ body: 'Bora às 20h?', authorRole: 'PLAYER' });
    as(s.owner);
    const staff = MatchChat.parse((await call('GET', s.path)).data);
    expect(staff).toMatchObject({ canPost: true, canModerate: true });
    expect(MatchChatMessage.parse((await call('POST', s.path, { body: 'Ok, sala 15 min antes.' })).data).authorRole).toBe('STAFF');
    as(s.opponent);
    const chat = MatchChat.parse((await call('GET', s.path)).data);
    expect(chat.canModerate).toBe(false);
    expect(chat.messages.map((m) => m.body)).toEqual(['Bora às 20h?', 'Ok, sala 15 min antes.']);
  });

  it('tamanho e limite de envio', async () => {
    const s = await scenario();
    as(BIANCA);
    expect((await call('POST', s.path, { body: '   ' })).status).toBe(400);
    expect((await call('POST', s.path, { body: 'x'.repeat(501) })).status).toBe(400);
    for (let i = 0; i < 5; i++) expect((await call('POST', s.path, { body: `msg ${i}` })).status).toBe(201);
    const blocked = await call('POST', s.path, { body: 'mais uma' });
    expect(blocked.status).toBe(429);
    expect(blocked.code).toBe('RATE_LIMITED');
  });

  it('ocultar e denunciar', async () => {
    const s = await scenario();
    as(BIANCA);
    const msg = MatchChatMessage.parse((await call('POST', s.path, { body: 'mensagem ofensiva' })).data);
    as(s.opponent);
    expect((await call('DELETE', `${s.path}/${msg.id}`)).status).toBe(403);
    const report = await call('POST', '/reports', { targetType: 'CHAT_MESSAGE', targetId: msg.id, reason: 'HARASSMENT', description: 'Ofensa no chat da partida.', evidenceUrls: [] });
    expect(report.status).toBe(201);
    expect((report.data as { targetLabel: string }).targetLabel).toContain('mensagem ofensiva');
    as(s.outsider);
    expect((await call('POST', '/reports', { targetType: 'CHAT_MESSAGE', targetId: msg.id, reason: 'HARASSMENT', description: 'Ofensa no chat da partida.', evidenceUrls: [] })).status).toBe(404);
    as(s.owner);
    expect(MatchChatMessage.parse((await call('DELETE', `${s.path}/${msg.id}`)).data)).toMatchObject({ hidden: true, body: 'mensagem ofensiva' });
    as(s.opponent);
    expect(MatchChat.parse((await call('GET', s.path)).data).messages.find((m) => m.id === msg.id)).toMatchObject({ hidden: true, body: '' });
  });
});
