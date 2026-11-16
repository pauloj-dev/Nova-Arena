import { defineConfig, devices } from '@playwright/test';

/**
 * E2E dos fluxos P0 em 360 px (celular) e 1440 px (desktop) — plano §4.3.
 * `PLAYWRIGHT_BASE_URL` aponta para o preview da Vercel no CI; sem ela, sobe o app local.
 */
// No CI a variável chega vazia enquanto não há preview da Vercel: vazio vale como "não definida".
const externalURL = process.env.PLAYWRIGHT_BASE_URL?.trim() || undefined;
const baseURL = externalURL ?? 'http://localhost:3100';
/**
 * `E2E_API_REAL=1`: roda só `api-real.spec.ts`, contra um preview com a API real (issue #81). Os demais specs
 * usam a API simulada (MSW) e ficam de fora nesse modo — e vice-versa.
 */
const apiReal = process.env.E2E_API_REAL === '1';
/** Preview protegido da Vercel: o segredo de automação libera o acesso do teste (e grava o cookie de liberação). */
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();

export default defineConfig({
  testDir: './e2e',
  ...(apiReal ? { testMatch: 'api-real.spec.ts' } : { testIgnore: 'api-real.spec.ts' }),
  // Execuções em paralelo (ex.: duas pessoas, ou CI + local) usam pastas de saída diferentes.
  outputDir: process.env.PW_OUTPUT_DIR ?? 'test-results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(bypass ? { extraHTTPHeaders: { 'x-vercel-protection-bypass': bypass, 'x-vercel-set-bypass-cookie': 'true' } } : {}),
  },
  projects: [
    { name: 'desktop-1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile-360', use: { ...devices['Pixel 7'], viewport: { width: 360, height: 780 } } },
    // A arte de resultado desenha em canvas e baixa PNG: confere também nos motores do Firefox e do Safari.
    ...(apiReal ? [] : [
    { name: 'firefox-arte', grep: /arte de resultado/, use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } } },
    { name: 'webkit-arte', grep: /arte de resultado/, use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } },
    ]),
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
