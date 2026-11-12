import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

interface IndexEntry {
  id: string;
  title: string;
  name: string;
  type: string;
}

const indexPath = join(import.meta.dirname, '..', 'storybook-static', 'index.json');
let entries: IndexEntry[] = [];
try {
  const index = JSON.parse(readFileSync(indexPath, 'utf8')) as { entries: Record<string, IndexEntry> };
  entries = Object.values(index.entries).filter((e) => e.type === 'story');
} catch {
  throw new Error('storybook-static não encontrado. Rode `pnpm --filter @nova/ui build-storybook` antes.');
}

const themes = ['light', 'dark'] as const;

/** Stories com screenshot: as principais de cada componente, nos dois temas. */
const screenshotIds = [
  'fundamentos-tokens--paleta',
  'fundamentos-tokens--tipografia',
  'fundamentos-tokens--espacamento-raio-e-sombra',
  'ações-button--variantes',
  'ações-button--tamanhos',
  'ações-button--carregando',
  'ações-button--desabilitado',
  'formulário-input--com-dica',
  'formulário-input--com-erro',
  'formulário-textarea--com-erro',
  'formulário-select--com-valor',
  'formulário-checkbox--lista',
  'formulário-switch--com-dica',
  'formulário-switch--desabilitado',
  'status-badge--tons',
  'status-statuspill--todos-os-status',
  'conteúdo-card--interativo',
  'conteúdo-avatar--tamanhos',
  'navegação-tabs--padrao',
  'navegação-stepper--horizontal',
  'navegação-stepper--vertical',
  'feedback-skeleton--cartao-de-campeonato',
  'feedback-emptystate--completo',
  'feedback-errorstate--com-tentar-novamente',
  'feedback-progress--escala',
  'feedback-toast--todos-os-tons',
  'sobreposição-modal--aberto',
  'sobreposição-confirmdestructive--aberto',
  'sobreposição-drawer--direita',
  'dados-datatable--completa',
  'dados-datatable--carregando',
  'dados-datatable--vazia-com-acao',
];

/** Áreas conferidas pelo axe além da padrão (o acento muda de cor). */
const areas = ['participant', 'organizer', 'admin'] as const;

async function openStory(page: Page, id: string, theme: string, area = 'participant') {
  await page.goto(`/iframe.html?viewMode=story&id=${encodeURIComponent(id)}&globals=theme:${theme};area:${area}`);
  await page.waitForFunction(() => {
    const root = document.querySelector('#storybook-root');
    return document.body.classList.contains('sb-show-main') && (root?.childElementCount ?? 0) > 0;
  });
  await page.evaluate(() => document.fonts.ready);
  // As imagens de Avatar e a entrada dos overlays terminam logo depois do primeiro quadro.
  await page.waitForLoadState('networkidle');
}

/** Nome de arquivo sem acento, para o repositório não depender da normalização Unicode do sistema. */
function fileName(id: string): string {
  return id.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

test('o Modal prende o foco e devolve ao gatilho quando fecha com Esc', async ({ page }) => {
  await openStory(page, 'sobreposição-modal--fechado', 'light');
  const trigger = page.getByRole('button', { name: 'Convidar jogador' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Convidar jogador' });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 10; i += 1) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('as stories com screenshot existem no Storybook', () => {
  const known = new Set(entries.map((e) => e.id));
  expect(screenshotIds.filter((id) => !known.has(id))).toEqual([]);
});

for (const theme of themes) {
  test.describe(`tema ${theme}`, () => {
    for (const id of screenshotIds) {
      test(`screenshot · ${id}`, async ({ page }) => {
        await openStory(page, id, theme);
        await expect(page).toHaveScreenshot(`${fileName(id)}--${theme}.png`, { fullPage: true });
      });
    }

    for (const entry of entries) {
      test(`axe · ${entry.title} · ${entry.name}`, async ({ page }) => {
        const narrow = /celular|drawer--embaixo/.test(entry.id);
        if (narrow) await page.setViewportSize({ width: 360, height: 740 });
        // O acento muda com a área: confere as três nas stories que não dependem de viewport.
        for (const area of narrow ? (['participant'] as const) : areas) {
          await openStory(page, entry.id, theme, area);
          const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
          const blocking = results.violations
            .filter((v) => v.impact === 'serious' || v.impact === 'critical')
            .map((v) => `${area} · ${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
          expect(blocking, entry.id).toEqual([]);
        }
      });
    }
  });
}
