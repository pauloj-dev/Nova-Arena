import { defineConfig, devices } from '@playwright/test';

/**
 * E2E dos fluxos P0 em 360 px (celular) e 1440 px (desktop) — plano §4.3.
 * `PLAYWRIGHT_BASE_URL` aponta para o preview da Vercel no CI; sem ela, sobe o app local.
 */
// No CI a variável chega vazia enquanto não há preview da Vercel: vazio vale como "não definida".
const externalURL = process.env.PLAYWRIGHT_BASE_URL?.trim() || undefined;
const baseURL = externalURL ?? 'http://localhost:3100';

export default defineConfig({
  testDir: './e2e',
  // Execuções em paralelo (ex.: duas pessoas, ou CI + local) usam pastas de saída diferentes.
  outputDir: process.env.PW_OUTPUT_DIR ?? 'test-results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: { baseURL, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop-1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile-360', use: { ...devices['Pixel 7'], viewport: { width: 360, height: 780 } } },
  ],
  webServer: externalURL
    ? undefined
    : {
        command: 'pnpm exec next build && pnpm exec next start -p 3100',
        url: baseURL,
        timeout: 600_000,
        reuseExistingServer: !process.env.CI,
      },
});
