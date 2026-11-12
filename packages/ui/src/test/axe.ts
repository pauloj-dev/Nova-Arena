import { axe } from 'vitest-axe';

/**
 * Roda o axe-core no elemento (por padrão o <body>, para pegar o que o Radix renderiza em portal)
 * e falha se houver qualquer violação. O contraste de cor fica de fora porque o jsdom não desenha:
 * ele é coberto por `styles/contrast.test.ts` (tokens) e pelo axe no navegador (`pnpm test:visual`).
 */
export async function expectNoA11yViolations(element: Element = document.body): Promise<void> {
  const results = await axe(element, {
    rules: {
      'color-contrast': { enabled: false },
      // Componentes soltos não têm <main>/landmarks em volta: essa regra só faz sentido na página inteira.
      region: { enabled: false },
    },
  });
  const violations = results.violations.map((v) => `${v.id} (${v.impact ?? 'sem impacto'}): ${v.help} → ${v.nodes.map((n) => n.html).join(' | ')}`);
  expect(violations).toEqual([]);
}
