import { defineConfig } from 'vitest/config';

// Os testes de banco rodam em sequência: compartilham o mesmo Postgres de teste.
export default defineConfig({ test: { include: ['test/**/*.test.ts'], passWithNoTests: true, fileParallelism: false, testTimeout: 20_000 } });
