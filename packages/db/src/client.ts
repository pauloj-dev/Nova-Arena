/**
 * Cliente do Prisma para a API. Uma instância por processo da função (o Fluid compute reaproveita o
 * processo entre requisições), sobre o pool do `pg` apontando para a URL **com pooler** do Neon.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

export type Db = PrismaClient;

export interface CreateDbOptions {
  /** Padrão: `DATABASE_URL`. */
  connectionString?: string;
  /** Conexões por instância da função. Funções escalam para muitas instâncias: mantenha baixo. */
  max?: number;
}

export function createDb(options: CreateDbOptions = {}): PrismaClient {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL não definida.');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, max: options.max ?? 5 }) });
}

const globalForDb = globalThis as unknown as { novaDb?: PrismaClient };

/** Instância compartilhada (criada na primeira chamada; em desenvolvimento sobrevive ao hot reload). */
export function db(): PrismaClient {
  globalForDb.novaDb ??= createDb();
  return globalForDb.novaDb;
}

/** `SELECT 1`: usado pelo health da API. */
export async function pingDb(client: PrismaClient = db()): Promise<void> {
  await client.$queryRaw`SELECT 1`;
}
