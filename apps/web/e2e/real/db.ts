/**
 * Banco dos E2E com a API real (issue #102). O protótipo começa cada teste com o banco simulado limpo; aqui o
 * equivalente é um **retrato** do banco semeado (`pnpm --filter web seed:demo --reset`), guardado no schema
 * `e2e_snapshot` e restaurado antes de cada teste:
 *
 * - restaurar = esvaziar as tabelas e copiar o retrato de volta, numa transação, com os gatilhos de "somente
 *   inserção" (auditoria, histórico de resultados) desligados só nela (`session_replication_role = replica`, pede
 *   superusuário — o Postgres do docker-compose é);
 * - toda coluna de data e hora anda o tempo que passou desde o retrato: a partida da Bianca continua "daqui a 20
 *   minutos" com o check-in aberto, não importa quanto tempo a suíte leve;
 * - o cache do servidor no Redis (prefixo `KV_PREFIX`) é apagado junto, para nenhuma tela ler o que o teste
 *   anterior deixou.
 *
 * Também cria sessões direto no banco (`createSession`): é o caminho equivalente ao `/auth/dev-login` do protótipo
 * — o login de verdade com a senha tem limite de 5 por minuto por IP e não serve para cada teste.
 */
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { requireServerEnv, serverEnv } from './env';

const SNAPSHOT = 'e2e_snapshot';

let pool: pg.Pool | null = null;
function db(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: serverEnv('DATABASE_URL_UNPOOLED') ?? requireServerEnv('DATABASE_URL'), max: 2 });
  return pool;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
}

export async function query<T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db().query<T>(sql, params)).rows;
}

interface TableInfo {
  name: string;
  columns: { name: string; shift: boolean; generated: boolean }[];
}

let tablesCache: TableInfo[] | null = null;
async function tables(): Promise<TableInfo[]> {
  if (tablesCache) return tablesCache;
  const rows = await query<{ table_name: string; column_name: string; data_type: string; is_generated: string; column_default: string | null }>(
    `SELECT c.table_name, c.column_name, c.data_type, c.is_generated, c.column_default
       FROM information_schema.columns c
       JOIN pg_tables t ON t.schemaname = c.table_schema AND t.tablename = c.table_name
      WHERE c.table_schema = 'public' AND c.table_name <> '_prisma_migrations'
      ORDER BY c.table_name, c.ordinal_position`,
  );
  const map = new Map<string, TableInfo>();
  for (const r of rows) {
    const info = map.get(r.table_name) ?? { name: r.table_name, columns: [] };
    info.columns.push({ name: r.column_name, shift: r.data_type === 'timestamp with time zone', generated: r.is_generated === 'ALWAYS' });
    map.set(r.table_name, info);
  }
  tablesCache = [...map.values()];
  return tablesCache;
}

/** Guarda o estado atual do banco como retrato (depois da seed). */
export async function takeSnapshot(): Promise<void> {
  const list = await tables();
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query(`DROP SCHEMA IF EXISTS ${SNAPSHOT} CASCADE`);
    await client.query(`CREATE SCHEMA ${SNAPSHOT}`);
    for (const t of list) await client.query(`CREATE TABLE ${SNAPSHOT}."${t.name}" AS SELECT * FROM public."${t.name}"`);
    await client.query(`CREATE TABLE ${SNAPSHOT}._meta AS SELECT now() AS taken_at`);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Volta o banco ao retrato, com as datas andando o tempo que passou desde ele. Também limpa o cache do servidor. */
export async function restoreSnapshot(): Promise<void> {
  // Uma requisição do teste anterior ainda em curso no servidor (polling, carga da página) pode disputar as mesmas
  // linhas com o TRUNCATE: em impasse ou espera longa, o Postgres desfaz e a restauração tenta de novo.
  for (let attempt = 1; ; attempt += 1) {
    try {
      await restoreOnce();
      break;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (attempt >= 5 || (code !== '40P01' && code !== '55P03' && code !== '40001')) throw error;
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }
  await clearServerCache();
}

async function restoreOnce(): Promise<void> {
  const list = await tables();
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL session_replication_role = replica');
    await client.query("SET LOCAL lock_timeout = '5s'");
    const shift = (await client.query<{ s: string }>(`SELECT (now() - taken_at)::text AS s FROM ${SNAPSHOT}._meta`)).rows[0]?.s ?? '0';
    await client.query(`TRUNCATE ${list.map((t) => `public."${t.name}"`).join(', ')}`);
    for (const t of list) {
      const cols = t.columns.filter((c) => !c.generated);
      const names = cols.map((c) => `"${c.name}"`).join(', ');
      const values = cols.map((c) => (c.shift ? `"${c.name}" + $1::interval` : `"${c.name}"`)).join(', ');
      await client.query(`INSERT INTO public."${t.name}" (${names}) SELECT ${values} FROM ${SNAPSHOT}."${t.name}"`, cols.some((c) => c.shift) ? [shift] : []);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Apaga as chaves do servidor no Redis (cache, limites e idempotência), pelo prefixo `KV_PREFIX`. */
export async function clearServerCache(): Promise<void> {
  const url = serverEnv('KV_REST_API_URL');
  const token = serverEnv('KV_REST_API_TOKEN');
  const prefix = serverEnv('KV_PREFIX');
  // Sem prefixo próprio, apagar seria mexer no Redis de outros ambientes: não apaga nada.
  if (!url || !token || !prefix) return;
  const call = async (command: unknown[]) => {
    const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
    return ((await res.json()) as { result: unknown }).result;
  };
  let cursor = '0';
  do {
    const [next, keys] = (await call(['SCAN', cursor, 'MATCH', `${prefix}*`, 'COUNT', 500])) as [string, string[]];
    if (keys.length) await call(['DEL', ...keys]);
    cursor = next;
  } while (cursor !== '0');
}

// ── Sessões ──────────────────────────────────────────────────────────

const b64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

/** JWT de acesso no mesmo formato da API (`packages/api/src/auth/jwt.ts`): HS256, emissor e público da Nova Arena. */
function signAccess(claims: { sub: string; sid: string; sv: number; tfa: boolean; roles: string[] }): string {
  const iat = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256' }));
  const payload = b64url(JSON.stringify({ sid: claims.sid, sv: claims.sv, tfa: claims.tfa, roles: claims.roles, sub: claims.sub, iss: 'nova-arena', aud: 'nova-arena-web', iat, exp: iat + 15 * 60 }));
  const signature = createHmac('sha256', requireServerEnv('AUTH_JWT_SECRET')).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

export interface SessionCookies {
  access: string;
  refresh: string;
}

/**
 * Abre uma sessão para a pessoa direto no banco, como o login faria (mesma tabela, mesmo hash do refresh token).
 * Admins já saem com o 2FA feito (`tfa`), como depois do código no login.
 */
export async function createSession(userId: string): Promise<SessionCookies> {
  const [user] = await query<{ session_version: number }>('SELECT "sessionVersion" AS session_version FROM users WHERE id = $1', [userId]);
  if (!user) throw new Error(`Usuário ${userId} não existe no banco (a seed de demonstração rodou?)`);
  const roles = (await query<{ role: string }>('SELECT role FROM user_roles WHERE "userId" = $1', [userId])).map((r) => r.role);
  const tfa = roles.includes('ADMIN') || roles.includes('SUPER_ADMIN');
  const refresh = randomBytes(32).toString('base64url');
  const sid = randomUUID();
  await query(
    `INSERT INTO sessions (id, "userId", "familyId", "refreshTokenHash", "sessionVersion", "twoFactorVerified", "expiresAt", "userAgent")
     VALUES ($1, $2, $3, $4, $5, $6, now() + interval '30 days', 'Playwright')`,
    [sid, userId, randomUUID(), createHash('sha256').update(refresh).digest('hex'), user.session_version, tfa],
  );
  return { access: signAccess({ sub: userId, sid, sv: user.session_version, tfa, roles }), refresh };
}
