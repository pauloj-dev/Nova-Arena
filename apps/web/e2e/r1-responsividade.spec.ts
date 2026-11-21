/**
 * R1.1 (#103): todas as telas nos 5 tamanhos do plano (360, 480, 768, 1024 e 1440 px) e em paisagem.
 * Falha com rolagem horizontal e anexa um screenshot de cada tela em cada tamanho ao relatório do Playwright.
 *
 * Para não repetir o trabalho nos dois projetos, o projeto de celular (toque, `isMobile`) cobre 360, 480,
 * 768 e a paisagem, e o de desktop cobre 1024 e 1440.
 */
import { expect, test } from './fixtures';
import { abrir, culpadosDoExcesso, excessoHorizontal, TAMANHOS, TELAS } from './rotas';

test.describe.configure({ timeout: 240_000 });

const DO_CELULAR = new Set(['360', '480', '768', 'paisagem']);

for (const tela of TELAS) {
  test(`${tela.nome} sem rolagem horizontal em todos os tamanhos (${tela.path})`, async ({ page }, testInfo) => {
    const celular = testInfo.project.name.startsWith('mobile');
    const tamanhos = TAMANHOS.filter((t) => DO_CELULAR.has(t.nome) === celular);
    await page.setViewportSize({ width: tamanhos[0]!.width, height: tamanhos[0]!.height });
    await abrir(page, tela);

    const problemas: string[] = [];
    for (const t of tamanhos) {
      await page.setViewportSize({ width: t.width, height: t.height });
      // O layout muda nos breakpoints: espera dois quadros para medir já com o novo layout.
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const excesso = await excessoHorizontal(page);
      if (excesso > 0) problemas.push(`${t.nome} px: passa ${excesso} px → ${(await culpadosDoExcesso(page)).join(' | ')}`);
      await testInfo.attach(`${tela.nome}-${t.nome}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    }
    expect(problemas, `rolagem horizontal em ${tela.path}`).toEqual([]);
  });
}
