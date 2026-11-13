/**
 * Auditoria imutável (issue #71). A parte de banco roda com `TEST_DATABASE_URL` (no CI, Postgres 17 já migrado).
 */
import { AUDIT_ACTIONS } from '@nova/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { audited, createDb, grantRole, revokeRole, withAudit, type Db, type Tx } from '../src';

describe('audited() sem banco', () => {
  it('recusa ação fora do catálogo antes de chegar ao banco', async () => {
    await expect(audited({} as Tx, { action: 'APAGAR_TUDO' as never, entityType: 'User', entityId: 'x' })).rejects.toThrow();
  });

  it('mudança de papel é do gatilho: audited() recusa ROLE_GRANTED', async () => {
    await expect(audited({} as Tx, { action: 'ROLE_GRANTED', entityType: 'User', entityId: 'x' })).rejects.toThrow(/gatilho/);
  });

  it('fora de withAudit() não grava (o registro precisa ir na transação da ação)', async () => {
    await expect(audited({} as Tx, { action: 'GAME_UPDATED', entityType: 'Game', entityId: 'x' })).rejects.toThrow(/withAudit/);
  });

  it('o catálogo é a lista única de ações', () => {
    expect(Object.keys(AUDIT_ACTIONS)).toContain('ROLE_GRANTED');
    expect(new Set(Object.values(AUDIT_ACTIONS)).size).toBe(Object.keys(AUDIT_ACTIONS).length);
  });
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('auditoria no banco (Postgres)', () => {
  let db: Db;
  let userId: string;
  let actorId: string;

  beforeAll(async () => {
    db = createDb({ connectionString: url, max: 2 });
    const stamp = Date.now();
    userId = (await db.user.create({ data: { email: `alvo-${stamp}@exemplo.com`, nickname: `Alvo${stamp}`, nicknameKey: `alvo${stamp}` } })).id;
    actorId = (await db.user.create({ data: { email: `admin-${stamp}@exemplo.com`, nickname: `Admin${stamp}`, nicknameKey: `admin${stamp}` } })).id;
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it('grava na mesma transação, com autor, IP e navegador do contexto, na partição do mês', async () => {
    await withAudit(db, { actorId, ip: '203.0.113.7', userAgent: 'Vitest' }, (tx) =>
      audited(tx, { action: 'GAME_UPDATED', entityType: 'Game', entityId: `g-${userId}`, entityLabel: 'Free Fire', before: { active: true }, after: { active: false } }),
    );
    const [row] = await db.$queryRaw<{ partition: string; actorId: string; ip: string; userAgent: string }[]>`
      SELECT tableoid::regclass::text AS partition, "actorId"::text AS "actorId", ip, "userAgent"
      FROM audit_logs WHERE "entityId" = ${`g-${userId}`}`;
    const month = new Date().toISOString().slice(0, 7).replace('-', '_');
    expect(row).toEqual({ partition: `audit.audit_logs_${month}`, actorId, ip: '203.0.113.7', userAgent: 'Vitest' });
  });

  it('se a ação falhar, não sobra registro', async () => {
    await expect(
      withAudit(db, { actorId }, async (tx) => {
        await audited(tx, { action: 'GAME_UPDATED', entityType: 'Game', entityId: `rollback-${userId}` });
        throw new Error('ação falhou');
      }),
    ).rejects.toThrow('ação falhou');
    expect(await db.auditLog.count({ where: { entityId: `rollback-${userId}` } })).toBe(0);
  });

  it('UPDATE, DELETE e TRUNCATE em audit_logs falham no banco', async () => {
    await expect(db.$executeRaw`UPDATE audit_logs SET action = 'X' WHERE "entityId" = ${`g-${userId}`}`).rejects.toThrow(/somente inserção/);
    await expect(db.$executeRaw`DELETE FROM audit_logs WHERE "entityId" = ${`g-${userId}`}`).rejects.toThrow(/somente inserção/);
    await expect(db.$executeRawUnsafe('TRUNCATE audit_logs')).rejects.toThrow(/somente inserção/);
    expect(await db.auditLog.count({ where: { entityId: `g-${userId}` } })).toBe(1);
  });

  it('toda mudança de papel gera registro, com o autor do contexto', async () => {
    await withAudit(db, { actorId, reason: 'Promovido pelo Admin' }, (tx) => grantRole(tx, userId, 'ORGANIZER', actorId));
    await withAudit(db, { actorId }, (tx) => revokeRole(tx, userId, 'ORGANIZER'));
    const logs = await db.auditLog.findMany({ where: { entityType: 'User', entityId: userId }, orderBy: { id: 'asc' } });
    expect(logs.map((l) => [l.action, l.actorId, l.after ?? l.before])).toEqual([
      ['ROLE_GRANTED', actorId, { role: 'ORGANIZER' }],
      ['ROLE_REVOKED', actorId, { role: 'ORGANIZER' }],
    ]);
    expect(logs[0]?.reason).toBe('Promovido pelo Admin');
    expect(logs[0]?.entityLabel).toMatch(/^Alvo/);
  });

  it('papel mudado fora de withAudit() também fica registrado (autor nulo = sistema)', async () => {
    await db.userRole.create({ data: { userId, role: 'ADMIN' } });
    const log = await db.auditLog.findFirst({ where: { entityId: userId, action: 'ROLE_GRANTED', after: { equals: { role: 'ADMIN' } } } });
    expect(log?.actorId).toBeNull();
    await db.userRole.delete({ where: { userId_role: { userId, role: 'ADMIN' } } });
  });

  it('partições mensais: criação idempotente e retenção mínima de 12 meses', async () => {
    await db.$queryRaw`SELECT audit.ensure_partitions(3)`;
    const [again] = await db.$queryRaw<{ created: number }[]>`SELECT audit.ensure_partitions(3) AS created`;
    expect(again?.created).toBe(0);
    await expect(db.$queryRaw`SELECT audit.drop_partitions_older_than(6)`).rejects.toThrow(/pelo menos 12 meses/);
    await expect(db.$queryRaw`SELECT audit.drop_partitions_older_than(12)`).resolves.toBeDefined();
  });
});
