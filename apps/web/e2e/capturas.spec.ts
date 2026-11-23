/**
 * Capturas de tela de todo o sistema, para documentação e relatórios (não é um teste de regra).
 * Só roda com `CAPTURAS_DIR` definido: grava uma imagem por tela do catálogo (`rotas.ts`) no tamanho do projeto
 * (celular 360 px e desktop 1440 px), e um `capturas.jsonl` com o índice.
 *
 *   CAPTURAS_DIR=/caminho/da/pasta PLAYWRIGHT_BASE_URL=http://localhost:3100 pnpm exec playwright test e2e/capturas.spec.ts
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { abrir, TELAS } from './rotas';

const DIR = process.env.CAPTURAS_DIR;

test.describe('capturas de tela', () => {
  test.skip(!DIR, 'defina CAPTURAS_DIR para gerar as capturas');

  for (const tela of TELAS) {
    test(`${tela.area} · ${tela.nome}`, async ({ page }, info) => {
      const tamanho = info.project.name.startsWith('mobile') ? 'celular' : 'desktop';
      const pasta = join(DIR as string, tamanho);
      mkdirSync(pasta, { recursive: true });
      await abrir(page, tela);
      // O seletor de usuários do protótipo não faz parte do produto: fica fora das capturas.
      await page.addStyleTag({ content: '[aria-label^="Protótipo: entrar como"]{display:none!important}' });
      const arquivo = `${String(TELAS.indexOf(tela) + 1).padStart(2, '0')}-${tela.nome}.jpg`;
      await page.screenshot({ path: join(pasta, arquivo), fullPage: true, type: 'jpeg', quality: 72 });
      appendFileSync(join(DIR as string, 'capturas.jsonl'), `${JSON.stringify({ tamanho, area: tela.area, nome: tela.nome, path: tela.path, como: tela.como ?? null, arquivo: `${tamanho}/${arquivo}` })}\n`);
      expect(true).toBe(true);
    });
  }
});
