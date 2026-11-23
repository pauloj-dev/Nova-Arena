/**
 * Gera as imagens de exemplo da leitura do print (issue 123): telas de resultado **inventadas**, sem marca nem
 * print de jogo real, desenhadas em HTML e fotografadas pelo Chromium do Playwright. Rode de novo se mudar o texto:
 *
 *   node apps/web/scripts/ocr-fixtures.mts
 *
 * Saída (versionada): apps/web/features/ocr/fixtures/queda-br.png e duelo.png. O que cada imagem mostra está no
 * teste `features/ocr/recognize.real.test.ts`.
 */
import { chromium } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../features/ocr/fixtures');

const page = (body: string) => `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; background: black; color: white; font: 600 28px/1.5 Arial, Helvetica, sans-serif; }
  main { padding: 24px 32px; width: 560px; }
  h1 { font-size: 30px; margin: 0 0 12px; letter-spacing: 2px; }
  table { border-collapse: collapse; width: 100%; }
  td { padding: 6px 12px; }
  td.n { text-align: right; width: 140px; }
  .score { font-size: 44px; text-align: center; margin: 12px 0; }
</style></head><body><main>${body}</main></body></html>`;

const drop = page(`<h1>RESULTADO DA QUEDA</h1><table>
  <tr><td>#1</td><td>Squad Charlie</td><td class="n">12 kills</td></tr>
  <tr><td>#2</td><td>Squad Alfa</td><td class="n">7 kills</td></tr>
  <tr><td>#3</td><td>Squad Delta</td><td class="n">3 kills</td></tr>
  <tr><td>#4</td><td>Squad Bravo</td><td class="n">0 kills</td></tr>
</table>`);

const duel = page(`<h1>FIM DE JOGO</h1><p class="score">Bianca 2 x 1 Lucas</p><p>Melhor de 3</p>`);

const browser = await chromium.launch();
try {
  const tab = await browser.newPage({ viewport: { width: 624, height: 400 }, deviceScaleFactor: 1 });
  for (const [name, html] of [
    ['queda-br', drop],
    ['duelo', duel],
  ] as const) {
    await tab.setContent(html);
    await tab.locator('main').screenshot({ path: `${out}/${name}.png` });
    console.log(`gerado ${name}.png`);
  }
} finally {
  await browser.close();
}
