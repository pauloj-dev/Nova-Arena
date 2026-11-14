/**
 * Seed do banco (`pnpm --filter @nova/db db:seed`). Idempotente: rodar de novo não duplica nada.
 *
 * Perfis (`SEED_PROFILE`):
 * - `dev` (padrão) e `staging`: catálogo + contas de demonstração.
 * - `production`: só o catálogo e o Super Admin de `SEED_SUPER_ADMIN_EMAIL` (sem conta de demonstração).
 *
 * As contas entram sem senha: a autenticação (issue #67) define o hash. Em produção, o Super Admin
 * entra pela recuperação de senha.
 */
import { createDb } from '../src/client';
import type { PrismaClient } from '../src/generated/prisma/client';
import { DEMO_USERS, GAMES, type SeedUser } from './seed-data';

type Profile = 'dev' | 'staging' | 'production';

function profileFromEnv(): Profile {
  const value = process.env.SEED_PROFILE ?? 'dev';
  if (value !== 'dev' && value !== 'staging' && value !== 'production') throw new Error(`SEED_PROFILE inválido: ${value} (use dev, staging ou production).`);
  return value;
}

export async function seedCatalog(db: PrismaClient): Promise<void> {
  for (const g of GAMES) {
    const game = await db.game.upsert({
      where: { slug: g.slug },
      create: { slug: g.slug, name: g.name, icon: g.icon, platform: g.platform, requiredAccountFields: g.requiredAccountFields as object[], extraStatFields: g.extraStatFields as object[] },
      // Catálogo já existente: o seed não sobrescreve o que o Admin editou.
      update: {},
    });
    for (const m of g.modes) {
      const existing = await db.gameMode.findFirst({ where: { gameId: game.id, name: m.name } });
      if (!existing) await db.gameMode.create({ data: { gameId: game.id, name: m.name, teamSize: m.teamSize, maxSubs: m.maxSubs, matchType: m.matchType, maxLobbySize: m.maxLobbySize } });
    }
    for (const s of g.scoringModels) {
      const existing = await db.scoringModel.findFirst({ where: { gameId: game.id, name: s.name, ownerId: null } });
      if (!existing) {
        await db.scoringModel.create({ data: { gameId: game.id, name: s.name, matchType: s.matchType, rules: s.rules as object[], tiebreakers: s.tiebreakers, isDefault: s.isDefault } });
      }
    }
  }
}

export async function seedUser(db: PrismaClient, u: SeedUser): Promise<string> {
  const email = u.email.toLowerCase();
  const user = await db.user.upsert({
    where: { email },
    create: { email, nickname: u.nickname, nicknameKey: u.nickname.toLowerCase(), emailVerified: true, state: u.state, bio: u.bio, country: 'Brasil' },
    update: {},
  });
  // Todo usuário tem PARTICIPANT (modelo de dados).
  for (const role of new Set([...u.roles, 'PARTICIPANT' as const])) {
    await db.userRole.upsert({ where: { userId_role: { userId: user.id, role } }, create: { userId: user.id, role }, update: {} });
  }
  if (u.roles.includes('ORGANIZER')) {
    await db.organizerLimits.upsert({
      where: { userId: user.id },
      create: { userId: user.id, verified: Boolean(u.verifiedOrganizer), maxActiveTournaments: u.verifiedOrganizer ? 10 : 3 },
      update: {},
    });
  }
  return user.id;
}

export async function seed(db: PrismaClient, profile: Profile): Promise<{ games: number; users: number }> {
  await seedCatalog(db);
  if (profile === 'production') {
    const email = process.env.SEED_SUPER_ADMIN_EMAIL;
    if (!email) throw new Error('Em produção, defina SEED_SUPER_ADMIN_EMAIL (o e-mail do Super Admin).');
    await seedUser(db, { email, nickname: 'SuperAdmin', roles: ['SUPER_ADMIN', 'ADMIN'] });
    return { games: GAMES.length, users: 1 };
  }
  for (const u of DEMO_USERS) await seedUser(db, u);
  return { games: GAMES.length, users: DEMO_USERS.length };
}

// Executado pela CLI (`prisma db seed`); importado nos testes sem rodar.
if (process.argv[1]?.replace(/\\/g, '/').endsWith('prisma/seed.ts')) {
  const profile = profileFromEnv();
  const db = createDb({ connectionString: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL });
  seed(db, profile)
    .then((r) => console.log(`Seed (${profile}) concluído: ${r.games} jogos, ${r.users} contas.`))
    .catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    })
    .finally(() => void db.$disconnect());
}
