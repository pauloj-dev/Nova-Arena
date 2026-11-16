/**
 * Integração com um Postgres de verdade. Roda quando `TEST_DATABASE_URL` aponta para um banco de teste
 * já migrado (no CI: serviço `postgres` do GitHub Actions + `prisma migrate deploy`). Sem a variável, pula.
 * Os testes não apagam nada: contam só os registros do seed (outros pacotes usam o mesmo banco em paralelo).
 * Mesmo assim, nunca aponte para um banco com dados reais.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, pingDb, type Db } from '../src';
import { seed } from '../prisma/seed';
import { DEMO_USERS, GAMES } from '../prisma/seed-data';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('banco de dados (Postgres)', () => {
  let db: Db;

  beforeAll(async () => {
    db = createDb({ connectionString: url, max: 2 });
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it('responde ao ping do health', async () => {
    await expect(pingDb(db)).resolves.toBeUndefined();
  });

  it('banco novo sobe só com migrations + seed, e rodar o seed de novo não duplica nada', async () => {
    const first = await seed(db, 'dev');
    expect(first).toEqual({ games: 4, users: 6 });
    const slugs = GAMES.map((g) => g.slug);
    const emails = DEMO_USERS.map((u) => u.email);
    const counts = async () => ({
      games: await db.game.count({ where: { slug: { in: slugs } } }),
      modes: await db.gameMode.count({ where: { game: { slug: { in: slugs } } } }),
      models: await db.scoringModel.count({ where: { game: { slug: { in: slugs } }, ownerId: null } }),
      users: await db.user.count({ where: { email: { in: emails } } }),
      roles: await db.userRole.count({ where: { user: { email: { in: emails } } } }),
    });
    const after1 = await counts();
    await seed(db, 'dev');
    expect(await counts()).toEqual(after1);
    expect(after1).toEqual({ games: 4, modes: 8, models: 7, users: 6, roles: 11 });
  });

  it('todo usuário do seed tem o papel PARTICIPANT; o Super Admin também é ADMIN', async () => {
    const rafael = await db.user.findUniqueOrThrow({ where: { email: 'rafael@novaarena.gg' }, include: { roles: true } });
    expect(rafael.roles.map((r) => r.role).sort()).toEqual(['ADMIN', 'PARTICIPANT', 'SUPER_ADMIN']);
    const withoutParticipant = await db.user.count({ where: { email: { in: DEMO_USERS.map((u) => u.email) }, roles: { none: { role: 'PARTICIPANT' } } } });
    expect(withoutParticipant).toBe(0);
  });

  it('apelido é único sem diferenciar maiúsculas (nicknameKey)', async () => {
    await expect(db.user.create({ data: { email: 'outra@exemplo.com', nickname: 'BIANCA', nicknameKey: 'bianca' } })).rejects.toThrow();
  });

  it('uma inscrição por pessoa e por squad no mesmo campeonato (PRD §17.2)', async () => {
    const owner = await db.user.findUniqueOrThrow({ where: { email: 'camila@novaarena.gg' } });
    const player = await db.user.findUniqueOrThrow({ where: { email: 'bianca@novaarena.gg' } });
    const game = await db.game.findUniqueOrThrow({ where: { slug: 'efootball' }, include: { modes: true } });
    const t = await db.tournament.create({
      data: { slug: 'teste-unicidade', name: 'Teste', gameId: game.id, gameModeId: game.modes[0]?.id ?? '', ownerId: owner.id, participantType: 'SOLO', maxParticipants: 8 },
    });
    await db.registration.create({ data: { tournamentId: t.id, userId: player.id, status: 'CONFIRMED' } });
    await expect(db.registration.create({ data: { tournamentId: t.id, userId: player.id, status: 'WAITLIST' } })).rejects.toThrow();
    await db.tournament.delete({ where: { id: t.id } });
  });

  it('SEED_DEMO_PASSWORD dá senha a quem não tem e nunca troca uma senha já definida', async () => {
    const lucas = await db.user.findUniqueOrThrow({ where: { email: 'lucas@novaarena.gg' } });
    await db.user.update({ where: { id: lucas.id }, data: { passwordHash: null } });
    const camila = await db.user.update({ where: { email: 'camila@novaarena.gg' }, data: { passwordHash: 'hash-definido-pela-pessoa' } });
    const previous = process.env.SEED_DEMO_PASSWORD;
    process.env.SEED_DEMO_PASSWORD = 'curta';
    await expect(seed(db, 'dev')).rejects.toThrow('8 caracteres');
    process.env.SEED_DEMO_PASSWORD = 'demo-arena-2026';
    await seed(db, 'dev');
    expect((await db.user.findUniqueOrThrow({ where: { id: lucas.id } })).passwordHash).toMatch(/^\$argon2id\$/);
    expect((await db.user.findUniqueOrThrow({ where: { id: camila.id } })).passwordHash).toBe('hash-definido-pela-pessoa');
    if (previous === undefined) delete process.env.SEED_DEMO_PASSWORD;
    else process.env.SEED_DEMO_PASSWORD = previous;
    await db.user.update({ where: { id: camila.id }, data: { passwordHash: null } });
  });

  it('o seed de produção exige o e-mail do Super Admin e não cria contas de demonstração', async () => {
    const previous = process.env.SEED_SUPER_ADMIN_EMAIL;
    delete process.env.SEED_SUPER_ADMIN_EMAIL;
    await expect(seed(db, 'production')).rejects.toThrow('SEED_SUPER_ADMIN_EMAIL');
    process.env.SEED_SUPER_ADMIN_EMAIL = 'Dono@Exemplo.com';
    await expect(seed(db, 'production')).resolves.toEqual({ games: 4, users: 1 });
    expect(await db.user.findUnique({ where: { email: 'dono@exemplo.com' } })).not.toBeNull();
    if (previous === undefined) delete process.env.SEED_SUPER_ADMIN_EMAIL;
    else process.env.SEED_SUPER_ADMIN_EMAIL = previous;
  });
});
