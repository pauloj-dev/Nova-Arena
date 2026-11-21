import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    passWithNoTests: true,
    // Os testes de integração dividem um único Postgres, e há rotinas globais (a varredura do Cron age sobre
    // todas as partidas vencidas do banco). Em paralelo, um arquivo enxerga os dados do outro: um por vez.
    fileParallelism: false,
    // Cenários de integração fazem dezenas de chamadas ao banco; o limite padrão de 5 s estoura em máquina carregada.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
