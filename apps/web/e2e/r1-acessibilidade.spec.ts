/**
 * R1.4 (#106): axe-core em todas as telas, nos temas claro e escuro, com 0 violações sérias ou críticas
 * (WCAG 2.0/2.1/2.2 A e AA). Roda nos dois projetos (1440 px e 360 px): o layout muda entre eles.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { abrir, TELAS } from './rotas';

test.describe.configure({ timeout: 120_000 });

const TEMAS = ['light', 'dark'] as const;

async function usarTema(page: Page, tema: (typeof TEMAS)[number]): Promise<void> {
  await page.emulateMedia({ colorScheme: tema });
  // O tema escolhido pela pessoa (botão de tema) vale mais que o do sistema: limpa para seguir a emulação.
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('nova-theme');
    } catch {
      /* sem armazenamento */
    }
  });
}

/**
 * Pendências em telas de outras frentes de trabalho (que este pacote não pode editar), registradas no relatório
 * de R1 e anotadas no teste. Cada item: tela, regra do axe e o seletor do elemento. Remover quando corrigido.
 */
const PENDENTES_DE_OUTRAS_FRENTES: { path: string; regra: string; seletor: RegExp; motivo: string }[] = [
  {
    path: '/admin',
    regra: 'label-content-name-mismatch',
    seletor: /min-h-28|border-accent|moderacao/,
    motivo: 'Cartões do dashboard (features/admin/dashboard) com aria-label que não começa pelo texto visível (WCAG 2.5.3).',
  },
];

async function violacoesGraves(page: Page, path: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    // Indicador do servidor de desenvolvimento do Next.js (não existe no build de produção).
    .exclude('nextjs-portal')
    // Conteúdo de terceiros (player do YouTube/Twitch): o iframe em si é conferido abaixo (precisa de título).
    .exclude('iframe[src*="youtube"], iframe[src*="twitch"]')
    .analyze();
  const pendentes = PENDENTES_DE_OUTRAS_FRENTES.filter((p) => p.path === path);
  const graves = results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ ...v, nodes: v.nodes.filter((n) => !pendentes.some((p) => p.regra === v.id && p.seletor.test(n.target.join(' ')))) }))
    .filter((v) => v.nodes.length > 0);
  for (const p of pendentes) test.info().annotations.push({ type: 'pendência de outra frente', description: `${p.regra}: ${p.motivo}` });
  return graves.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

for (const tela of TELAS) {
  for (const tema of TEMAS) {
    test(`axe: ${tela.nome} no tema ${tema === 'light' ? 'claro' : 'escuro'} (${tela.path})`, async ({ page }) => {
      // Sem rede de terceiros no teste: o player de vídeo não carrega (e não muda o resultado de uma vez para outra).
      await page.route(/^https:\/\/(www\.)?(youtube(-nocookie)?\.com|player\.twitch\.tv)\//, (route) => route.abort());
      await usarTema(page, tema);
      await abrir(page, tela);
      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(tema);
      expect(await violacoesGraves(page, tela.path), `violações em ${tela.path}`).toEqual([]);
      const semTitulo = await page.locator('iframe:not([title]), iframe[title=""]').count();
      expect(semTitulo, 'todo iframe precisa de título').toBe(0);
    });
  }
}
