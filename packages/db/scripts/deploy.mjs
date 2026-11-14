/* global process, console */
/**
 * `prisma migrate deploy` no build da Vercel (plano §4.2), contra o banco daquele ambiente.
 *
 * - Fora da Vercel (CI, máquina local) não faz nada: o build não precisa de banco.
 * - Na Vercel sem banco configurado, avisa e segue (ex.: antes da issue #64 terminar).
 * - Na Vercel com banco, aplica as migrations pendentes; se falhar, o deploy falha.
 *
 * Regra: toda migration precisa ser compatível com a versão anterior do código (docs/banco.md),
 * porque o rollback da Vercel é instantâneo e o do banco não.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!process.env.VERCEL && process.env.FORCE_MIGRATE !== '1') {
  console.log('[db] Fora da Vercel: migrations não aplicadas no build (use `pnpm --filter @nova/db db:migrate`).');
  process.exit(0);
}
if (!url) {
  console.warn('[db] Nenhuma URL de banco neste ambiente: migrations não aplicadas. Configure o Neon (docs/infra-vercel.md).');
  process.exit(0);
}

const result = spawnSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(result.status ?? 1);
