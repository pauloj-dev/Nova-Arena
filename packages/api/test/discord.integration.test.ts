/**
 * Bot do Discord (issue 121) contra um Postgres de verdade (`TEST_DATABASE_URL`), com interações assinadas por uma
 * chave Ed25519 de teste (nada chama o Discord de verdade: o `fetch` dos avisos é trocado no teste).
 *
 * Cobre: assinatura (válida, forjada, ausente, bot desligado), rotas da organização × papéis, código de uso único,
 * `/nova-arena vincular` (permissão no Discord, conta vinculada, organização), `proxima`, `checkin`, os avisos postos
 * na fila pelos mesmos eventos de `notify`/`publish` e a entrega pelo job (sucesso, canal sem permissão, limite de taxa).
 */
import { DiscordInteractionResponse, DiscordLinkCode, DiscordLinkStatus, Match } from '@nova/schemas';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { SignJWT } from 'jose';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createApp, envFrom } from '../src';
import { hashLinkCode, verifyDiscordSignature } from '../src/discord';
import { createHarness, SERIES_RULES, type Harness } from './fixtures/arena';

const url = process.env.TEST_DATABASE_URL;

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const PUBLIC_HEX = Buffer.from(publicKey.export({ format: 'jwk' }).x as string, 'base64url').toString('hex');
const QSTASH = { QSTASH_CURRENT_SIGNING_KEY: 'chave-atual-discord', QSTASH_NEXT_SIGNING_KEY: 'chave-seguinte-discord' };
const DISCORD_ENV = { DISCORD_APP_ID: '123456789012345678', DISCORD_PUBLIC_KEY: PUBLIC_HEX, DISCORD_BOT_TOKEN: 'token-de-teste', NEXT_PUBLIC_SITE_URL: 'https://novaarena.gg', ...QSTASH };
const MANAGE_GUILD = '32';

function signed(body: unknown, opts: { forge?: boolean; omit?: boolean } = {}) {
  const raw = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = sign(null, Buffer.from(timestamp + raw), privateKey).toString('hex');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!opts.omit) {
    headers['X-Signature-Ed25519'] = opts.forge ? signature.replace(/^./, (ch) => (ch === 'a' ? 'b' : 'a')) : signature;
    headers['X-Signature-Timestamp'] = timestamp;
  }
  return { method: 'POST', headers, body: raw };
}

function command(sub: string, who: { discordId: string; permissions?: string }, extra: { code?: string; guild?: boolean } = {}) {
  const inGuild = extra.guild !== false;
  return {
    id: 'i1',
    type: 2,
    token: 'tok',
    ...(inGuild ? { guild_id: 'g-1', channel_id: 'c-1', guild: { id: 'g-1', name: 'Servidor da Liga' }, member: { user: { id: who.discordId, username: 'x' }, permissions: who.permissions ?? '0' } } : { channel_id: 'dm', user: { id: who.discordId, username: 'x' } }),
    data: { name: 'nova-arena', options: [{ type: 1, name: sub, ...(extra.code ? { options: [{ type: 3, name: 'codigo', value: extra.code }] } : {}) }] },
  };
}

describe('assinatura Ed25519 (sem banco)', () => {
  it('confere a assinatura e recusa formato errado', () => {
    const raw = '{"type":1}';
    const ts = '1700000000';
    const good = sign(null, Buffer.from(ts + raw), privateKey).toString('hex');
    expect(verifyDiscordSignature(PUBLIC_HEX, good, ts, raw)).toBe(true);
    expect(verifyDiscordSignature(PUBLIC_HEX, good, ts, `${raw} `)).toBe(false);
    expect(verifyDiscordSignature(PUBLIC_HEX, good, '1700000001', raw)).toBe(false);
    expect(verifyDiscordSignature(PUBLIC_HEX, 'zz', ts, raw)).toBe(false);
    expect(verifyDiscordSignature(PUBLIC_HEX, undefined, ts, raw)).toBe(false);
  });

  it('bot desligado (sem as variáveis): a rota responde 401 e o resto da API segue', async () => {
    const app = createApp({ env: envFrom({ NODE_ENV: 'test' }) });
    expect((await app.request('/api/v1/discord/interactions', signed({ id: 'i', type: 1 }))).status).toBe(401);
    expect((await app.request('/api/v1/health')).status).not.toBe(500);
  });
});

describe.skipIf(!url)('bot do Discord (Postgres)', () => {
  let h: Harness;
  let tournamentId = '';
  let stageId = '';
  const interact = (body: unknown, opts?: { forge?: boolean; omit?: boolean }) => h.app.request('/api/v1/discord/interactions', signed(body, opts));
  async function say(body: unknown): Promise<string> {
    const res = await interact(body);
    expect(res.status).toBe(200);
    return DiscordInteractionResponse.parse(await res.json()).data?.content ?? '';
  }
  const discordOf = (key: string) => `d-${key}-${h.id(key).slice(0, 8)}`;

  beforeAll(async () => {
    h = await createHarness(url as string, 'dsc', DISCORD_ENV);
    await h.user('dono', ['ORGANIZER', 'PARTICIPANT']);
    await h.user('co');
    await h.user('mod');
    await h.user('a');
    await h.user('b');
    await h.user('semconta');
    for (const key of ['dono', 'co', 'mod', 'a', 'b']) await h.db.oAuthAccount.create({ data: { userId: h.id(key), provider: 'discord', providerAccountId: discordOf(key) } });
    const cr = await h.game('DUEL', [{ name: 'coroas', rules: SERIES_RULES }]);
    const t = await h.tournament({ owner: 'dono', game: cr, name: 'Liga *Discord*', checkIn: true, stages: [{ name: 'Final', format: 'SINGLE_ELIM', model: 'coroas', seeding: 'RANKED' }] });
    tournamentId = t.id;
    stageId = t.stageIds[0] as string;
    await h.staff(t.id, 'co', 'CO_ORGANIZER', 'dono');
    await h.staff(t.id, 'mod', 'MODERATOR', 'dono');
    await h.register(t.id, [{ user: 'a' }, { user: 'b' }]);
  });

  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    await h?.db.$disconnect();
  });

  it('PING com assinatura válida: PONG; forjada ou ausente: 401', async () => {
    const pong = await interact({ id: 'i', type: 1 });
    expect(pong.status).toBe(200);
    expect(await pong.json()).toEqual({ type: 1 });
    expect((await interact({ id: 'i', type: 1 }, { forge: true })).status).toBe(401);
    expect((await interact({ id: 'i', type: 1 }, { omit: true })).status).toBe(401);
  });

  it('estado do vínculo: visitante 401, jogador e moderador 403, dono e co-organizador 200', async () => {
    const path = `/tournaments/${tournamentId}/discord`;
    expect((await h.call(null, path)).status).toBe(401);
    expect((await h.call('a', path)).status).toBe(403);
    expect((await h.call('mod', path)).status).toBe(403);
    expect((await h.call('co', path)).status).toBe(200);
    const status = DiscordLinkStatus.parse((await h.call('dono', path)).data);
    expect(status).toMatchObject({ enabled: true, state: 'NONE' });
    expect(status.installUrl).toContain('client_id=123456789012345678');
    expect((await h.call('mod', `${path}/code`, { method: 'POST' })).status).toBe(403);
    expect((await h.call('dono', `${path}/test`, { method: 'POST' })).code).toBe('DISCORD_NOT_LINKED');
  });

  it('vincular: código de uso único, só com "Gerenciar servidor", conta vinculada e da organização', async () => {
    const path = `/tournaments/${tournamentId}/discord`;
    const created = await h.call('dono', `${path}/code`, { method: 'POST' });
    expect(created.status).toBe(201);
    const { code, command: cmd } = DiscordLinkCode.parse(created.data);
    expect(cmd).toBe(`/nova-arena vincular codigo:${code}`);
    // Só o hash fica no banco.
    const row = await h.db.discordLink.findUniqueOrThrow({ where: { tournamentId } });
    expect(row.codeHash).toBe(hashLinkCode(code));
    expect(JSON.stringify(row)).not.toContain(code);
    expect(DiscordLinkStatus.parse((await h.call('dono', path)).data).state).toBe('PENDING');

    expect(await say(command('vincular', { discordId: discordOf('dono'), permissions: MANAGE_GUILD }, { code, guild: false }))).toMatch(/dentro do canal/);
    expect(await say(command('vincular', { discordId: discordOf('dono'), permissions: '0' }, { code }))).toMatch(/Gerenciar servidor/);
    expect(await say(command('vincular', { discordId: 'desconhecido', permissions: MANAGE_GUILD }, { code }))).toMatch(/Vincular Discord/);
    expect(await say(command('vincular', { discordId: discordOf('a'), permissions: MANAGE_GUILD }, { code }))).toMatch(/Só a organização/);
    expect(await say(command('vincular', { discordId: discordOf('mod'), permissions: MANAGE_GUILD }, { code }))).toMatch(/Só a organização/);
    expect(await say(command('vincular', { discordId: discordOf('dono'), permissions: MANAGE_GUILD }, { code: 'NA-ERRA-DO00' }))).toMatch(/inválido ou vencido/);

    const ok = await interact(command('vincular', { discordId: discordOf('co'), permissions: MANAGE_GUILD }, { code: code.toLowerCase() }));
    const okBody = DiscordInteractionResponse.parse(await ok.json());
    expect(okBody.data?.content).toMatch(/Este canal agora recebe os avisos de \*\*Liga \\\*Discord\\\*\*\*/);
    // Mensagem pública (sem a flag de "só você vê") e sem menções.
    expect(okBody.data?.flags).toBeUndefined();
    expect(okBody.data?.allowed_mentions).toEqual({ parse: [] });
    const status = DiscordLinkStatus.parse((await h.call('dono', path)).data);
    expect(status).toMatchObject({ state: 'ACTIVE', guildId: 'g-1', guildName: 'Servidor da Liga', channelId: 'c-1', codeExpiresAt: null });
    expect(status.linkedByNickname).toContain('dsc');
    // O código não vale de novo.
    expect(await say(command('vincular', { discordId: discordOf('co'), permissions: MANAGE_GUILD }, { code }))).toMatch(/inválido ou vencido/);
  });

  it('avisos pela fila: chave saiu, lembrete de 15 min ao agendar e resultado lançado', async () => {
    const before = h.jobs.length;
    expect((await h.call('dono', `/stages/${stageId}/generate`, { method: 'POST', body: { seeding: 'RANKED' } })).status).toBe(200);
    expect((await h.call('dono', `/stages/${stageId}/confirm`, { method: 'POST' })).status).toBe(200);
    const bracket = h.jobs.slice(before).find((j) => j.path === '/jobs/discord/announce');
    expect(bracket?.body).toMatchObject({ tournamentId, kind: 'BRACKET_RELEASED' });
    expect((bracket?.body as { content: string }).content).toContain('A chave saiu!');

    const [final] = z.array(Match).parse((await h.call('dono', `/tournaments/${tournamentId}/matches`)).data);
    const at = new Date(h.clock.now.getTime() + 20 * 60_000);
    const mark = h.jobs.length;
    expect((await h.call('dono', `/matches/${final?.id}`, { method: 'PATCH', body: { scheduledAt: at.toISOString() } })).status).toBe(200);
    const reminder = h.jobs.slice(mark).find((j) => j.path === '/jobs/discord/reminder');
    expect(reminder?.body).toEqual({ matchId: final?.id, scheduledAt: at.toISOString() });
  });

  it('/nova-arena proxima e /nova-arena checkin (janela aberta), em mensagem só para quem chamou', async () => {
    const next = await interact(command('proxima', { discordId: discordOf('a') }));
    const body = DiscordInteractionResponse.parse(await next.json());
    expect(body.data?.flags).toBe(64);
    expect(body.data?.content).toMatch(/Sua próxima partida/);
    expect(body.data?.content).toMatch(/<t:\d+:F>/);
    expect(await say(command('proxima', { discordId: 'desconhecido' }))).toMatch(/Vincular Discord/);
    expect(await say(command('checkin', { discordId: discordOf('dono') }))).toMatch(/não tem check-in aberto/);

    // A janela abre 30 min antes e fecha 10 min antes: a partida está a 20 min.
    expect(await say(command('checkin', { discordId: discordOf('a') }, { guild: false }))).toMatch(/Check-in feito/);
    const regA = await h.db.registration.findFirstOrThrow({ where: { tournamentId, userId: h.id('a') } });
    expect(await h.db.checkIn.count({ where: { registrationId: regA.id, userId: h.id('a') } })).toBe(1);
    // Repetir não duplica.
    expect(await say(command('checkin', { discordId: discordOf('a') }))).toMatch(/Check-in feito/);
    expect(await h.db.checkIn.count({ where: { registrationId: regA.id } })).toBe(1);
  });

  it('resultado lançado vira aviso na fila', async () => {
    const [final] = z.array(Match).parse((await h.call('dono', `/tournaments/${tournamentId}/matches`)).data);
    const mark = h.jobs.length;
    const entries = (final?.participants ?? []).map((p, i) => ({ registrationId: p.registrationId as string, score: i === 0 ? 1 : 0 }));
    expect((await h.call('dono', `/matches/${final?.id}/result`, { method: 'PUT', body: { entries, evidenceUrls: [] } })).status).toBe(200);
    const announce = h.jobs.slice(mark).find((j) => j.path === '/jobs/discord/announce');
    expect(announce?.body).toMatchObject({ tournamentId, kind: 'RESULT_POSTED' });
  });

  describe('entrega pelo job do QStash', () => {
    async function qstash(path: string, body: unknown) {
      const raw = JSON.stringify(body);
      const hash = createHash('sha256').update(raw).digest('base64url');
      const token = await new SignJWT({ body: hash })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setIssuer('Upstash')
        .setSubject(`https://novaarena.gg/api/v1${path}`)
        .setIssuedAt()
        .setNotBefore('0s')
        .setExpirationTime('5m')
        .sign(new TextEncoder().encode(QSTASH.QSTASH_CURRENT_SIGNING_KEY));
      return h.app.request(`/api/v1${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Upstash-Signature': token }, body: raw });
    }
    const job = () => ({ tournamentId, kind: 'TEST', content: 'Aviso @everyone' });

    it('sem assinatura: 401', async () => {
      const res = await h.app.request('/api/v1/jobs/discord/announce', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(job()) });
      expect(res.status).toBe(401);
    });

    it('entrega no canal com o token do bot e sem menções; marca o último aviso', async () => {
      const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
      vi.stubGlobal('fetch', fetcher);
      const res = await qstash('/jobs/discord/announce', job());
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, delivered: true });
      const [target, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
      expect(target).toBe('https://discord.com/api/v10/channels/c-1/messages');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bot token-de-teste');
      expect(JSON.parse(init.body as string)).toEqual({ content: 'Aviso @everyone', allowed_mentions: { parse: [] } });
      const status = DiscordLinkStatus.parse((await h.call('dono', `/tournaments/${tournamentId}/discord`)).data);
      expect(status.lastAnnouncementAt).not.toBeNull();
      expect(status.lastError).toBeNull();
    });

    it('canal sem permissão (403): registra o problema e não pede nova tentativa', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })));
      const res = await qstash('/jobs/discord/announce', job());
      expect(res.status).toBe(200);
      expect(DiscordLinkStatus.parse((await h.call('dono', `/tournaments/${tournamentId}/discord`)).data).lastError).toMatch(/permissão/);
    });

    it('limite de taxa ou falha do Discord: 500 para o QStash tentar de novo', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 429 })));
      expect((await qstash('/jobs/discord/announce', job())).status).toBe(500);
    });

    it('lembrete de partida reagendada ou já concluída não sai', async () => {
      const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
      vi.stubGlobal('fetch', fetcher);
      const [final] = z.array(Match).parse((await h.call('dono', `/tournaments/${tournamentId}/matches`)).data);
      const stale = await qstash('/jobs/discord/reminder', { matchId: final?.id, scheduledAt: '2020-01-01T00:00:00.000Z' });
      expect(await stale.json()).toMatchObject({ stale: true });
      const done = await qstash('/jobs/discord/reminder', { matchId: final?.id, scheduledAt: final?.scheduledAt });
      expect(await done.json()).toMatchObject({ skipped: true });
      expect(fetcher).not.toHaveBeenCalled();
    });

    it('aviso de teste da organização entra na fila; desvincular apaga o vínculo', async () => {
      const mark = h.jobs.length;
      expect((await h.call('dono', `/tournaments/${tournamentId}/discord/test`, { method: 'POST' })).status).toBe(202);
      expect(h.jobs.slice(mark).find((j) => j.path === '/jobs/discord/announce')?.body).toMatchObject({ kind: 'TEST' });
      expect((await h.call('mod', `/tournaments/${tournamentId}/discord`, { method: 'DELETE' })).status).toBe(403);
      const res = await h.call('dono', `/tournaments/${tournamentId}/discord`, { method: 'DELETE' });
      expect(DiscordLinkStatus.parse(res.data).state).toBe('NONE');
      expect(await h.db.discordLink.count({ where: { tournamentId } })).toBe(0);
    });
  });

  it('sem as variáveis do Discord, a organização vê o bot desligado e o código é recusado (503)', async () => {
    const off = await createHarness(url as string, 'dsx');
    await off.user('dono', ['ORGANIZER']);
    const cr = await off.game('DUEL', [{ name: 'coroas', rules: SERIES_RULES }]);
    const t = await off.tournament({ owner: 'dono', game: cr, stages: [{ name: 'Final', format: 'SINGLE_ELIM', model: 'coroas' }] });
    expect(DiscordLinkStatus.parse((await off.call('dono', `/tournaments/${t.id}/discord`)).data)).toMatchObject({ enabled: false, installUrl: null, state: 'NONE' });
    expect((await off.call('dono', `/tournaments/${t.id}/discord/code`, { method: 'POST' })).code).toBe('DISCORD_DISABLED');
    await off.db.$disconnect();
  });
});
