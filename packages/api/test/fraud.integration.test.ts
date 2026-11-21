/**
 * Antifraude (issue #114) contra o Postgres: ações administrativas em massa (critério de aceite: 10 banimentos em
 * 1 minuto pelo mesmo Admin geram alerta e avisam o Super Admin), ID de jogo repetido, várias contas no mesmo IP e
 * no mesmo aparelho, e a fila de alertas (quem vê, quem analisa, auditoria).
 */
import { createDb, type PrismaClient } from '@nova/db';
import { FraudAlert, FraudAlertPage, FRAUD_THRESHOLDS } from '@nova/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/crypto';
import { createHarness, lastAudit, type Harness } from './fixtures/admin';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('antifraude: alertas e fila da moderação (Postgres)', () => {
  let db: PrismaClient;
  let h: Harness;
  const id = (key: string) => h.people.get(key)?.id ?? '';
  const ipBase = `198.51.${Math.floor(Math.random() * 200) + 20}`;

  beforeAll(async () => {
    db = createDb({ connectionString: url, max: 4 });
    h = createHarness(db, 'fr');
    await h.makeUser('rafael', ['SUPER_ADMIN', 'ADMIN']);
    await h.makeUser('sara', ['SUPER_ADMIN', 'ADMIN']);
    await h.makeUser('ana', ['ADMIN']);
    for (let i = 1; i <= 12; i += 1) await h.makeUser(`p${i}`, []);
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  async function alertsFor(who: string, query = '') {
    return FraudAlertPage.parse((await h.call(who, 'GET', `/admin/fraud-alerts${query}`)).data);
  }

  it('10 banimentos em 1 minuto pelo mesmo Admin geram alerta e avisam os Super Admins; 9 não', async () => {
    for (let i = 1; i <= 9; i += 1) expect((await h.call('ana', 'POST', `/admin/users/${id(`p${i}`)}/sanctions`, { type: 'BAN', reason: 'Conta usada para manipular resultado' })).status).toBe(201);
    expect(await db.fraudAlert.count({ where: { kind: 'MASS_ADMIN_ACTION', actorId: id('ana') } })).toBe(0);

    expect((await h.call('ana', 'POST', `/admin/users/${id('p10')}/sanctions`, { type: 'BAN', reason: 'Conta usada para manipular resultado' })).status).toBe(201);
    const alert = await db.fraudAlert.findFirstOrThrow({ where: { kind: 'MASS_ADMIN_ACTION', actorId: id('ana') } });
    expect(alert).toMatchObject({ status: 'OPEN', severity: 'HIGH', occurrences: 1, details: { action: 'BAN', count: 10, threshold: FRAUD_THRESHOLDS.massActions.BAN } });
    for (const who of ['rafael', 'sara']) {
      expect(await db.notification.count({ where: { userId: id(who), type: 'SANCTION', title: 'Alerta: ações administrativas em massa', link: '/admin/moderacao?aba=alertas' } })).toBe(1);
    }
    expect(await db.notification.count({ where: { userId: id('ana'), title: 'Alerta: ações administrativas em massa' } })).toBe(0);

    // O 11º soma no mesmo alerta (sem novo aviso).
    expect((await h.call('ana', 'POST', `/admin/users/${id('p11')}/sanctions`, { type: 'BAN', reason: 'Conta usada para manipular resultado' })).status).toBe(201);
    expect(await db.fraudAlert.findUniqueOrThrow({ where: { id: alert.id } })).toMatchObject({ occurrences: 2, details: { count: 11 } });
    expect(await db.notification.count({ where: { userId: id('rafael'), title: 'Alerta: ações administrativas em massa' } })).toBe(1);
  });

  it('o alerta de ações em massa só aparece para o Super Admin, e quem o disparou não analisa', async () => {
    const forAna = await alertsFor('ana', '?kind=MASS_ADMIN_ACTION');
    expect(forAna.items.find((a) => a.actor?.id === id('ana'))).toBeUndefined();
    const forRafael = await alertsFor('rafael', '?kind=MASS_ADMIN_ACTION&status=OPEN');
    const alert = forRafael.items.find((a) => a.actor?.id === id('ana'));
    expect(alert).toMatchObject({ kind: 'MASS_ADMIN_ACTION', summary: `${h.people.get('ana')?.nickname} fez 11 banimentos em 60 s.` });
    // Admin não alcança o alerta nem pelo id.
    expect((await h.call('ana', 'PATCH', `/admin/fraud-alerts/${alert?.id}`, { status: 'DISMISSED', resolution: 'Limpeza combinada de contas falsas' })).status).toBe(404);
    // Participante: 403.
    expect((await h.call('p12', 'GET', '/admin/fraud-alerts')).status).toBe(403);
    const res = await h.call('rafael', 'PATCH', `/admin/fraud-alerts/${alert?.id}`, { status: 'ACTIONED', resolution: 'Banimentos revistos com a Ana; dois foram revertidos.' });
    expect(res.status).toBe(200);
    expect(FraudAlert.parse(res.data)).toMatchObject({ status: 'ACTIONED', reviewedByNickname: h.people.get('rafael')?.nickname });
    expect(await lastAudit(db, 'FRAUD_ALERT_REVIEWED', { entityId: alert?.id })).toMatchObject({ actorId: id('rafael'), after: { status: 'ACTIONED' } });
    expect((await h.call('sara', 'PATCH', `/admin/fraud-alerts/${alert?.id}`, { status: 'DISMISSED', resolution: 'De novo, sem efeito' })).code).toBe('ALERT_CLOSED');
  });

  it('o mesmo ID de jogo em duas contas gera alerta (normalizado: espaços e maiúsculas não escondem)', async () => {
    const game = await db.game.create({ data: { slug: `fr-${h.stamp}`, name: `Jogo FR ${h.stamp}`, requiredAccountFields: [{ key: 'playerId', label: 'ID' }, { key: 'nick', label: 'Nick' }] } });
    expect((await h.call('p12', 'PUT', `/me/game-accounts/${game.id}`, { fields: { playerId: 'AB 123 45', nick: 'Alfa' } })).status).toBe(200);
    expect(await db.fraudAlert.count({ where: { kind: 'DUPLICATE_GAME_ID', userIds: { has: id('p12') } } })).toBe(0);
    await h.makeUser('dup', []);
    expect((await h.call('dup', 'PUT', `/me/game-accounts/${game.id}`, { fields: { playerId: 'ab12345', nick: 'Beta' } })).status).toBe(200);
    const page = await alertsFor('ana', '?kind=DUPLICATE_GAME_ID&status=OPEN');
    const alert = page.items.find((a) => a.users.some((u) => u.id === id('dup')));
    expect(alert?.users.map((u) => u.id).sort()).toEqual([id('p12'), id('dup')].sort());
    expect(alert?.summary).toBe(`O ID "ab12345" do Jogo FR ${h.stamp} está em 2 contas.`);
    expect(page.openCount).toBeGreaterThanOrEqual(1);
    // Admin pode analisar (não é sobre Admin); explicação curta é recusada.
    expect((await h.call('ana', 'PATCH', `/admin/fraud-alerts/${alert?.id}`, { status: 'DISMISSED', resolution: 'ok' })).code).toBe('VALIDATION');
    expect((await h.call('ana', 'PATCH', `/admin/fraud-alerts/${alert?.id}`, { status: 'DISMISSED', resolution: 'Irmãos dividindo a conta do jogo; orientados.' })).status).toBe(200);
  });

  async function login(key: string, ip: string, device?: string) {
    const person = h.people.get(key);
    const res = await h.app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { Origin: 'http://localhost', 'Content-Type': 'application/json', 'X-Forwarded-For': ip, ...(device ? { Cookie: `na_dev=${device}` } : {}) },
      body: JSON.stringify({ email: person?.email, password: 'senhaForte#2026' }),
    });
    expect(res.status).toBe(200);
    return res.headers.getSetCookie().find((c) => c.startsWith('na_dev='));
  }

  it('várias contas no mesmo aparelho e no mesmo IP geram alertas', async () => {
    const hash = await hashPassword('senhaForte#2026');
    for (const key of ['d1', 'd2', 'd3', 'i1', 'i2', 'i3', 'i4', 'i5']) {
      await h.makeUser(key, []);
      await db.user.update({ where: { id: id(key) }, data: { passwordHash: hash } });
    }
    // Aparelho: o cookie nasce no primeiro login e volta nos seguintes (IPs diferentes).
    const cookie = await login('d1', `${ipBase}.1`);
    const device = cookie?.split(';')[0]?.split('=')[1];
    expect(device).toMatch(/^[0-9a-f-]{36}$/);
    await login('d2', `${ipBase}.2`, device);
    expect(await db.fraudAlert.count({ where: { kind: 'MULTI_ACCOUNT_DEVICE', dedupeKey: `MULTI_ACCOUNT_DEVICE:${device}` } })).toBe(0);
    await login('d3', `${ipBase}.3`, device);
    const byDevice = await db.fraudAlert.findFirstOrThrow({ where: { kind: 'MULTI_ACCOUNT_DEVICE', dedupeKey: `MULTI_ACCOUNT_DEVICE:${device}` } });
    expect(byDevice.userIds.sort()).toEqual([id('d1'), id('d2'), id('d3')].sort());

    // IP: cinco contas (CGNAT pede limite alto), cada uma com aparelho próprio.
    const ip = `${ipBase}.99`;
    for (const key of ['i1', 'i2', 'i3', 'i4']) await login(key, ip);
    expect(await db.fraudAlert.count({ where: { dedupeKey: `MULTI_ACCOUNT_IP:${ip}` } })).toBe(0);
    await login('i5', ip);
    const byIp = await db.fraudAlert.findFirstOrThrow({ where: { dedupeKey: `MULTI_ACCOUNT_IP:${ip}` } });
    expect(byIp).toMatchObject({ kind: 'MULTI_ACCOUNT_IP', details: { accounts: 5, ip: `${ipBase}.99`.replace(/\.\d+$/, '.x') } });
    const page = await alertsFor('ana', '?kind=MULTI_ACCOUNT_IP');
    expect(page.items.find((a) => a.id === byIp.id)?.summary).toBe(`5 contas entraram do IP ${ipBase}.x em 24 h.`);
  });
});
