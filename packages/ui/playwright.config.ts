import { defineConfig } from '@playwright/test';

const PORT = 6106;

/**
 * Regressão visual e axe em cima do Storybook estático (`pnpm build-storybook` antes).
 * Por padrão usa o Chromium do Playwright (`pnpm exec playwright install chromium`).
 * Para usar o Google Chrome instalado na máquina: `PW_CHANNEL=chrome pnpm test:visual`.
 */
export default defineConfig({
  testDir: './visual',
  outputDir: './test-results',
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list']],
  expect: {
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.001 },
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: process.env.PW_CHANNEL || undefined,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    reducedMotion: 'reduce',
  },
  projects: [{ name: 'chromium' }],
  webServer: {
    command: `pnpm exec vite preview --outDir storybook-static --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/index.json`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
