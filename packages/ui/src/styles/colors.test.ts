// @vitest-environment node
import { join } from 'node:path';
import { findColors, findColorsInSource } from '../../scripts/check-colors.mjs';

const packageRoot = join(import.meta.dirname, '..', '..');

// As cores de exemplo são montadas em pedaços para este arquivo não acusar a si mesmo.
const hash = '#';
const open = '(';

describe('regra "nenhuma cor fora dos tokens"', () => {
  it('não há cor literal em packages/ui/src fora de tokens.css', () => {
    const violations = findColors(['src'], { cwd: packageRoot });
    expect(violations.map((v) => `${v.file}:${v.line} ${v.match}`)).toEqual([]);
  });

  it('tokens.css é o único arquivo liberado', () => {
    const violations = findColors(['src'], { cwd: packageRoot, allow: [] });
    expect(violations.length).toBeGreaterThan(0);
    expect(new Set(violations.map((v) => v.file))).toEqual(new Set([join('src', 'styles', 'tokens.css')]));
  });

  it.each([
    ['hex de 3 dígitos', `color: ${hash}fff;`],
    ['hex de 6 dígitos', `const cor = '${hash}16A34A';`],
    ['hex com alfa', `border-color: ${hash}16a34a80;`],
    ['valor arbitrário do Tailwind', `<div className="bg-[${hash}0f172a]" />`],
    ['função rgb', `color: rgb${open}22 163 74);`],
    ['função rgba', `box-shadow: 0 1px 2px rgba${open}6, 95, 70, 0.06);`],
    ['função hsl', `background: hsl${open}142 76% 36%);`],
    ['função oklch', `color: oklch${open}0.63 0.17 149);`],
  ])('acusa %s', (_name, source) => {
    expect(findColorsInSource(source)).toHaveLength(1);
  });

  it.each([
    ['classe ligada a token', '<div className="bg-surface text-muted border-border-strong" />'],
    ['variável de token', 'background: var(--surface);'],
    ['color-mix com tokens', 'box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-primary-500) 70%, transparent);'],
    ['referência a issue', '// ver a issue #14'],
    ['âncora', '<a href="#conteudo">Pular para o conteúdo</a>'],
    ['entidade HTML', '<span>&#169;</span>'],
    ['campo privado', 'class Fila { #itens = []; }'],
  ])('não acusa %s', (_name, source) => {
    expect(findColorsInSource(source)).toEqual([]);
  });

  it('informa linha e coluna, e respeita o comentário de exceção', () => {
    const source = ['a {', `  color: ${hash}fff;`, '  /* check-colors-ignore */', `  background: ${hash}000;`, '}'].join('\n');
    expect(findColorsInSource(source)).toEqual([{ line: 2, column: 10, match: `${hash}fff`, text: `color: ${hash}fff;` }]);
  });
});
