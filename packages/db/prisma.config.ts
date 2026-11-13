/**
 * Configuração da CLI do Prisma. As migrations usam a conexão **sem pooler** (`DATABASE_URL_UNPOOLED`,
 * criada pela integração do Neon; o plano a chama de `DIRECT_URL`). Sem ela, cai na `DATABASE_URL`.
 */
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '',
  },
});
