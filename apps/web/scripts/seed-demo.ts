/**
 * Seed de demonstração da API real (issue #102): grava no Postgres os mesmos cenários do protótipo
 * (`mocks/seed.ts`), para o preview, o staging e os E2E com a API real.
 *
 *   pnpm --filter web seed:demo            # usa DATABASE_URL(_UNPOOLED) e as chaves do ambiente (ou do .env.local)
 *   pnpm --filter web seed:demo --reset    # só local: apaga TODOS os dados do banco antes (pede superusuário do Postgres)
 *
 * Variáveis: `DATABASE_URL_UNPOOLED` (ou `DATABASE_URL`), `SEED_DEMO_PASSWORD` (senha das contas, 8+ caracteres),
 * `LOBBY_ENCRYPTION_KEY` (a mesma do servidor: as salas vão cifradas), `TWO_FACTOR_ENCRYPTION_KEY` e
 * `SEED_DEMO_TOTP_SECRET` (opcionais: Rafael e Ana nascem com 2FA nesse segredo Base32). Nunca em produção.
 */
import { createDb } from '@nova/db';
import { parseEnv } from '@nova/api';
import { seedDemo, type DemoReport } from '@nova/api/demo';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEMO_NOTIFICATIONS } from '../mocks/handlers/notifications';
import { buildSeed } from '../mocks/seed';

/** Lê `apps/web/.env.local` sem sobrescrever o que já veio do ambiente. */
function loadEnvLocal(): void {
  const file = fileURLToPath(new URL('../.env.local', import.meta.url));
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match?.[1] && process.env[match[1]] === undefined) process.env[match[1]] = match[2]?.replace(/^["']|["']$/g, '');
  }
}

/** Denúncias de demonstração (as mesmas que a API simulada semeia em `mocks/handlers/reports.ts`). */
function demoReports(now: number, users: { id: string; nickname: string }[], teams: { id: string; name: string; tag: string; captainId: string }[]): DemoReport[] {
  const DAY = 24 * 3600_000;
  const nick = (id: string) => users.find((u) => u.id === id)?.nickname ?? id;
  const squad = teams.find((t) => t.id === 't_2');
  const at = (ms: number) => new Date(now - ms).toISOString();
  const list: DemoReport[] = [
    {
      id: 'rp_demo_1',
      reporterId: 'u_bianca',
      targetType: 'USER',
      targetId: 'u_p10',
      targetLabel: nick('u_p10'),
      targetLink: `/u/${encodeURIComponent(nick('u_p10'))}`,
      targetOwnerUserId: 'u_p10',
      reason: 'HARASSMENT',
      description: 'Ficou me xingando no chat do jogo depois que perdeu a partida das oitavas.',
      status: 'ACTIONED',
      resolution: 'Conferimos as mensagens e o jogador recebeu uma advertência. Obrigado por avisar.',
      handledById: 'u_ana',
      createdAt: at(6 * DAY),
      updatedAt: at(5 * DAY),
    },
    {
      id: 'rp_demo_3',
      reporterId: 'u_lucas',
      targetType: 'USER',
      targetId: 'u_p12',
      targetLabel: nick('u_p12'),
      targetLink: `/u/${encodeURIComponent(nick('u_p12'))}`,
      targetOwnerUserId: 'u_p12',
      reason: 'OFFENSIVE_NAME',
      description: 'O nick no jogo tinha um palavrão. Parece que já foi trocado.',
      status: 'DISMISSED',
      resolution: 'O nick já havia sido alterado quando analisamos. Nenhuma medida foi necessária.',
      handledById: 'u_ana',
      createdAt: at(12 * DAY),
      updatedAt: at(11 * DAY),
    },
  ];
  if (squad) {
    list.splice(1, 0, {
      id: 'rp_demo_2',
      reporterId: 'u_lucas',
      targetType: 'TEAM',
      targetId: squad.id,
      targetLabel: `${squad.name} [${squad.tag}]`,
      targetLink: `/minha-conta/squads/${squad.id}`,
      targetOwnerUserId: squad.captainId,
      reason: 'CHEATING',
      description: 'Suspeita de jogador usando emulador nas quedas do último treino. Vários abates impossíveis no celular.',
      status: 'OPEN',
      resolution: null,
      handledById: null,
      createdAt: at(5 * 3600_000),
      updatedAt: at(5 * 3600_000),
    });
  }
  return list;
}

/** Apaga todos os dados (menos o histórico de migrations). Só local: desliga os gatilhos de "somente inserção". */
async function resetDatabase(db: ReturnType<typeof createDb>): Promise<void> {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await db.$transaction([db.$executeRawUnsafe('SET LOCAL session_replication_role = replica'), db.$executeRawUnsafe(`TRUNCATE ${list} CASCADE`)]);
}

async function main(): Promise<void> {
  loadEnvLocal();
  if (process.env.VERCEL_ENV === 'production' || process.env.SEED_PROFILE === 'production') throw new Error('A seed de demonstração nunca roda em produção.');
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Defina DATABASE_URL (ou DATABASE_URL_UNPOOLED).');
  const password = process.env.SEED_DEMO_PASSWORD;
  if (password !== undefined && password.length < 8) throw new Error('SEED_DEMO_PASSWORD precisa de pelo menos 8 caracteres.');
  const env = parseEnv(process.env);
  const db = createDb({ connectionString: url, max: 3 });
  try {
    if (process.argv.includes('--reset')) {
      await resetDatabase(db);
      console.log('Banco zerado.');
    }
    const data = buildSeed();
    const applied = await seedDemo(db, env, data, {
      password,
      totpSecret: env.TWO_FACTOR_ENCRYPTION_KEY ? process.env.SEED_DEMO_TOTP_SECRET : undefined,
      notifications: DEMO_NOTIFICATIONS,
      reports: demoReports(Date.now(), data.users, data.teams),
      log: (line) => console.log(line),
    });
    console.log(applied ? 'Seed de demonstração concluída.' : 'Nada a fazer.');
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
