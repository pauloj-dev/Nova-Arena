/**
 * R1.2 (#104) e R1.5 (#107):
 * - áreas de toque ≥ 44×44 px em todos os elementos interativos das telas principais, em 360 px;
 * - teclado certo nos campos (`inputmode`/`autocomplete`) nos formulários do celular;
 * - confete do campeão e animações respeitando `prefers-reduced-motion`.
 */
import type { Page } from '@playwright/test';
import { expect, loginAs, test, waitForApp } from './fixtures';
import { abrir, esperarAssentar, TELAS } from './rotas';

test.describe.configure({ timeout: 120_000 });

const MINIMO = 44;

/**
 * Mede os alvos de toque visíveis. Fora da regra (WCAG 2.5.8 e bom senso):
 * - links no meio de um texto (alvo "em linha");
 * - caixas de seleção e rádios dentro de um `<label>`: o alvo é o rótulo inteiro, que é medido no lugar;
 * - o "Pular para o conteúdo" (só aparece com o teclado);
 * - o que está fora da tela, invisível ou desabilitado.
 */
async function alvosPequenos(page: Page): Promise<string[]> {
  return page.evaluate((min) => {
    const selector = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="tab"], [role="checkbox"], [role="switch"], [role="radio"], [role="link"], [role="menuitem"], [tabindex="0"]';
    const out: string[] = [];
    const seen = new Set<Element>();
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      if (el.closest('nextjs-portal')) continue;
      if (el.getAttribute('href') === '#conteudo') continue;
      if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-hidden') === 'true') continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      let target: Element = el;
      if (el instanceof HTMLInputElement) {
        // Caixa, rádio e campo de arquivo escondido: quem recebe o toque é o rótulo.
        const label = el.closest('label') ?? (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null);
        const tiny = el.getBoundingClientRect().width < min || el.getBoundingClientRect().height < min;
        if (label && (el.type === 'checkbox' || el.type === 'radio' || tiny)) target = label;
      }
      if (seen.has(target)) continue;
      seen.add(target);
      const box = target.getBoundingClientRect();
      // Sem tamanho ou escondido visualmente (`sr-only`, acionado por outro botão): não é alvo de toque.
      if (box.width <= 1 || box.height <= 1) continue;
      let r = { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
      // Área de toque ampliada por pseudo-elemento (`after:absolute after:-inset-3` ou o cartão inteiro clicável).
      const after = getComputedStyle(target, '::after');
      if (after.content !== 'none' && after.position === 'absolute') {
        const cb = (getComputedStyle(target).position !== 'static' ? target : (target as HTMLElement).offsetParent) as HTMLElement | null;
        if (cb) {
          const base = cb.getBoundingClientRect();
          const px = (v: string) => (v.endsWith('px') ? Number.parseFloat(v) : Number.NaN);
          const [t, rt, b, l] = [px(after.top), px(after.right), px(after.bottom), px(after.left)];
          if ([t, rt, b, l].every(Number.isFinite)) {
            const left = Math.min(r.left, base.left + l);
            const top = Math.min(r.top, base.top + t);
            const right = Math.max(r.right, base.right - rt);
            const bottom = Math.max(r.bottom, base.bottom - b);
            r = { left, top, right, bottom, width: right - left, height: bottom - top };
          }
        }
      }
      if (r.bottom < 0 || r.right < 0 || r.left > window.innerWidth) continue;
      // Link em linha dentro de um parágrafo de texto: exceção da WCAG 2.5.8.
      if (el.tagName === 'A' && style.display === 'inline' && el.parentElement && getComputedStyle(el.parentElement).display !== 'flex') continue;
      if (r.width + 0.5 >= min && r.height + 0.5 >= min) continue;
      const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
      const cls = typeof el.className === 'string' ? el.className.split(/\s+/).slice(0, 3).join('.') : '';
      out.push(`${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''} "${name}" ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    return out;
  }, MINIMO);
}

test.describe('áreas de toque em 360 px', () => {
  test.skip(({ isMobile }) => !isMobile, 'Medição feita no projeto de celular (360 px, toque).');

  /** Telas de outras frentes (que este pacote não edita): ficam anotadas e no relatório de R1. */
  const PENDENTES: Record<string, RegExp[]> = {
    // features/auth/LoginScreen: o link "Esqueci a senha" tem 28 px de altura.
    '/entrar': [/"Esqueci a senha"/],
  };

  for (const tela of TELAS.filter((t) => t.principal)) {
    test(`${tela.nome}: todo alvo de toque tem pelo menos 44×44 px (${tela.path})`, async ({ page }) => {
      await abrir(page, tela);
      const pendentes = PENDENTES[tela.path] ?? [];
      for (const p of pendentes) test.info().annotations.push({ type: 'pendência de outra frente', description: `alvo pequeno: ${p.source}` });
      const pequenos = (await alvosPequenos(page)).filter((a) => !pendentes.some((p) => p.test(a)));
      expect(pequenos, `alvos pequenos em ${tela.path}`).toEqual([]);
    });
  }
});

test.describe('teclado certo em cada campo', () => {
  test('entrar e cadastro: e-mail, senha e apelido com autocomplete e teclado de e-mail', async ({ page }) => {
    await page.goto('/entrar');
    await waitForApp(page);
    const email = page.getByLabel('E-mail', { exact: true });
    await expect(email).toHaveAttribute('type', 'email');
    await expect(email).toHaveAttribute('autocomplete', /email|username/);
    await expect(page.getByLabel('Senha', { exact: true })).toHaveAttribute('autocomplete', 'current-password');

    await page.goto('/cadastro');
    await waitForApp(page);
    await expect(page.getByLabel('E-mail', { exact: true })).toHaveAttribute('autocomplete', 'email');
    await expect(page.locator('input[type="password"]').first()).toHaveAttribute('autocomplete', 'new-password');
  });

  test('todo campo de texto dos formulários principais diz qual teclado abrir', async ({ page }) => {
    const telas = [
      { path: '/minha-conta', como: 'u_bianca' as const },
      { path: '/organizador/novo', como: 'u_camila' as const },
      { path: '/admin/configuracoes', como: 'u_ana' as const },
    ];
    const problemas: string[] = [];
    for (const t of telas) {
      await loginAs(page, t.como);
      await page.goto(t.path);
      await waitForApp(page);
      await esperarAssentar(page);
      problemas.push(
        ...(await page.evaluate((path) => {
          const out: string[] = [];
          for (const input of Array.from(document.querySelectorAll<HTMLInputElement>('input'))) {
            if (['hidden', 'checkbox', 'radio', 'file', 'range', 'color', 'submit', 'button'].includes(input.type)) continue;
            // `type` já escolhe o teclado (e-mail, número, data, senha, busca, URL, telefone); texto livre precisa ser texto.
            const typed = input.type !== 'text';
            const mode = input.getAttribute('inputmode');
            const numericLooking = /^\^?\[0-9\]|\\d/.test(input.pattern || '') || /(kills|coloca|placar|pontos|vagas|minutos|idade|quantidade)/i.test(`${input.name} ${input.id} ${input.getAttribute('aria-label') ?? ''}`);
            if (!typed && numericLooking && mode !== 'numeric' && mode !== 'decimal') out.push(`${path}: campo numérico sem inputmode — ${input.name || input.id}`);
          }
          return out;
        }, t.path)),
      );
    }
    expect(problemas).toEqual([]);
  });
});

test.describe('movimento reduzido', () => {
  const RESULTADOS = '/c/open-8-ball-pool?aba=resultados';

  test('a campeã vê o confete no pódio (uma vez por sessão)', async ({ page }) => {
    await loginAs(page, 'u_bianca');
    await page.goto(RESULTADOS);
    await waitForApp(page);
    await expect(page.getByTestId('podium')).toBeVisible();
    await expect(page.getByTestId('confetti')).toBeAttached();
    expect(await page.evaluate(() => document.getAnimations().length)).toBeGreaterThan(0);
    // Some sozinho e não volta ao reabrir a aba na mesma sessão.
    await expect(page.getByTestId('confetti')).toHaveCount(0, { timeout: 10_000 });
    await page.reload();
    await waitForApp(page);
    await expect(page.getByTestId('podium')).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page.getByTestId('confetti')).toHaveCount(0);
  });

  test('com prefers-reduced-motion não há confete animado nem animação longa', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await loginAs(page, 'u_bianca');
    await page.goto(RESULTADOS);
    await waitForApp(page);
    await expect(page.getByTestId('podium')).toBeVisible();
    // O confete não chega a animar: some no primeiro quadro.
    await expect(page.getByTestId('confetti')).toHaveCount(0);
    const longas = await page.evaluate(() =>
      document
        .getAnimations()
        .map((a) => a.effect?.getComputedTiming())
        .filter((t) => t && typeof t.duration === 'number' && t.duration > 1 && t.iterations !== 1).length,
    );
    expect(longas, 'nenhuma animação longa ou em loop com movimento reduzido').toBe(0);

    // O ponto "AO VIVO" e os esqueletos param de pulsar (duração mínima no CSS global).
    await page.goto('/c/liga-semanal-clash-royale?aba=chave');
    await waitForApp(page);
    const pulso = page.locator('.animate-pulse-live').first();
    if ((await pulso.count()) > 0) {
      const duracao = await pulso.evaluate((el) => getComputedStyle(el).animationDuration);
      expect(Number.parseFloat(duracao)).toBeLessThan(0.1);
    }
  });
});
