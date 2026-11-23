/**
 * Preparação dos E2E com a API real (`E2E_MODE=real`): zera o banco do servidor, grava a seed de demonstração
 * (`pnpm --filter web seed:demo --reset`) e guarda o retrato que cada teste restaura (`e2e/real/db.ts`).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { closeDb, restoreSnapshot, takeSnapshot } from './db';
import { isRealApi, requireServerEnv, serverEnv } from './env';

export default async function globalSetup(): Promise<void> {
  if (!isRealApi) return;
  const cwd = path.resolve(__dirname, '../..');
  const env = { ...process.env, DATABASE_URL: requireServerEnv('DATABASE_URL'), DATABASE_URL_UNPOOLED: serverEnv('DATABASE_URL_UNPOOLED') ?? requireServerEnv('DATABASE_URL') };
  const seed = spawnSync('pnpm', ['exec', 'tsx', 'scripts/seed-demo.ts', '--reset'], { cwd, env, encoding: 'utf8' });
  if (seed.status !== 0) throw new Error(`A seed de demonstração falhou:\n${seed.stdout}\n${seed.stderr}`);
  await takeSnapshot();
  await restoreSnapshot();
  await closeDb();
}
