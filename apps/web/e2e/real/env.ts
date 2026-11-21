/**
 * Modo dos E2E (issue #102): `E2E_MODE=real` roda a suíte inteira contra a **API real** (servidor com
 * `NEXT_PUBLIC_API_MOCK=none` e Postgres semeado com `pnpm --filter web seed:demo`). Sem ela, os E2E usam a API
 * simulada (MSW), como sempre.
 *
 * As variáveis do servidor (banco, segredo do JWT, Redis) vêm do ambiente ou de `apps/web/.env.local` — o mesmo
 * arquivo que o `next dev`/`next start` lê. Só o Playwright (Node) usa este módulo; nada daqui vai para o navegador.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const isRealApi = process.env.E2E_MODE === 'real';

let fileEnv: Record<string, string> | null = null;

function envLocal(): Record<string, string> {
  if (fileEnv) return fileEnv;
  fileEnv = {};
  // O Playwright carrega os testes como CommonJS: `__dirname` é a pasta deste arquivo.
  const file = path.resolve(__dirname, '../../.env.local');
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (match?.[1]) fileEnv[match[1]] = (match[2] ?? '').replace(/^["']|["']$/g, '');
    }
  }
  return fileEnv;
}

/** Variável do servidor: primeiro o ambiente do Playwright, depois o `.env.local` do app. */
export function serverEnv(key: string): string | undefined {
  const value = process.env[`E2E_${key}`] ?? process.env[key] ?? envLocal()[key];
  return value === '' ? undefined : value;
}

export function requireServerEnv(key: string): string {
  const value = serverEnv(key);
  if (!value) throw new Error(`E2E com a API real: defina ${key} (no ambiente ou em apps/web/.env.local).`);
  return value;
}
