import { DiscordInteractionResponse, DiscordLinkCode, DiscordLinkStatus } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { db } from '../db';
import { as, call, setupMockApi } from '../testing';

setupMockApi();

const LIGA = 'liga-semanal-clash-royale';

function liga() {
  const t = db().tournaments.find((x) => x.slug === LIGA);
  if (!t) throw new Error('seed sem a liga');
  return t;
}

const vincular = (code: string, permissions = '32') => ({
  id: 'i',
  type: 2,
  guild_id: 'g1',
  channel_id: 'c1',
  guild: { id: 'g1', name: 'Servidor da Liga' },
  member: { user: { id: 'd1' }, permissions },
  data: { name: 'nova-arena', options: [{ type: 1, name: 'vincular', options: [{ type: 3, name: 'codigo', value: code }] }] },
});
const sub = (name: string) => ({ id: 'i', type: 2, channel_id: 'dm', user: { id: 'd1' }, data: { name: 'nova-arena', options: [{ type: 1, name }] } });

describe('bot do Discord na API simulada (mesmo contrato da real)', () => {
  it('só quem gerencia vê e vincula; o código vale uma vez; aviso de teste e desvincular', async () => {
    const t = liga();
    as('u_bianca');
    expect((await call('GET', `/tournaments/${t.id}/discord`)).status).toBe(403);
    as(t.ownerId);
    expect(DiscordLinkStatus.parse((await call('GET', `/tournaments/${t.id}/discord`)).data)).toMatchObject({ enabled: true, state: 'NONE' });
    expect((await call('POST', `/tournaments/${t.id}/discord/test`)).code).toBe('DISCORD_NOT_LINKED');
    const created = await call('POST', `/tournaments/${t.id}/discord/code`);
    expect(created.status).toBe(201);
    const { code } = DiscordLinkCode.parse(created.data);
    expect(DiscordLinkStatus.parse((await call('GET', `/tournaments/${t.id}/discord`)).data).state).toBe('PENDING');

    const noPerm = DiscordInteractionResponse.parse((await call('POST', '/discord/interactions', vincular(code, '0'))).data);
    expect(noPerm.data?.content).toMatch(/Gerenciar servidor/);
    as('u_bianca');
    expect(DiscordInteractionResponse.parse((await call('POST', '/discord/interactions', vincular(code))).data).data?.content).toMatch(/Só a organização/);
    as(t.ownerId);
    const ok = DiscordInteractionResponse.parse((await call('POST', '/discord/interactions', vincular(code))).data);
    expect(ok.data?.content).toMatch(/Este canal agora recebe os avisos/);
    expect(DiscordLinkStatus.parse((await call('GET', `/tournaments/${t.id}/discord`)).data)).toMatchObject({ state: 'ACTIVE', guildName: 'Servidor da Liga', channelId: 'c1' });
    expect(DiscordInteractionResponse.parse((await call('POST', '/discord/interactions', vincular(code))).data).data?.content).toMatch(/inválido ou vencido/);

    expect((await call('POST', `/tournaments/${t.id}/discord/test`)).status).toBe(202);
    expect(DiscordLinkStatus.parse((await call('GET', `/tournaments/${t.id}/discord`)).data).lastAnnouncementAt).not.toBeNull();
    expect(DiscordLinkStatus.parse((await call('DELETE', `/tournaments/${t.id}/discord`)).data).state).toBe('NONE');
  });

  it('PING, próxima partida e check-in da pessoa logada', async () => {
    expect((await call('POST', '/discord/interactions', { id: 'i', type: 1 })).data).toEqual({ type: 1 });
    as('u_bianca');
    const next = DiscordInteractionResponse.parse((await call('POST', '/discord/interactions', sub('proxima'))).data);
    expect(next.data?.flags).toBe(64);
    expect(next.data?.content).toMatch(/Sua próxima partida/);
    // A partida da Bianca nas quartas está com o check-in aberto no seed.
    expect(DiscordInteractionResponse.parse((await call('POST', '/discord/interactions', sub('checkin'))).data).data?.content).toMatch(/Check-in feito/);
  });
});
