import { describe, expect, it } from 'vitest';
// @ts-expect-error -- script Node em JavaScript puro (sem tipos), testado pelas funções exportadas
import { buildBudget, computeRouteSizes, limitFor, overLimit, routeFromEntry } from './check-bundle-size.mjs';

const KB = 1024;

describe('routeFromEntry', () => {
  it('tira grupos de rota e o sufixo /page', () => {
    expect(routeFromEntry('/(site)/c/[slug]/page')).toBe('/c/[slug]');
    expect(routeFromEntry('/(site)/page')).toBe('/');
    expect(routeFromEntry('/admin/usuarios/[id]/page')).toBe('/admin/usuarios/[id]');
  });
});

describe('computeRouteSizes', () => {
  const sizes: Record<string, number> = { 'runtime.js': 100 * KB, 'layout.js': 30 * KB, 'page-a.js': 40 * KB, 'page-b.js': 5 * KB };
  const rows = computeRouteSizes({
    rootMainFiles: ['runtime.js'],
    pages: [
      // O layout aparece em várias entradas da mesma rota: conta uma vez só.
      { entry: '/(site)/a/page', entryJSFiles: { layout: ['layout.js'], error: ['layout.js'], page: ['layout.js', 'page-a.js'] } },
      { entry: '/b/page', entryJSFiles: { layout: ['layout.js'], page: ['page-b.js'] } },
    ],
    sizeOf: (file: string) => sizes[file] ?? 0,
  });

  it('soma a união dos chunks iniciais (runtime + segmentos), do maior para o menor', () => {
    expect(rows).toEqual([
      { route: '/a', files: 3, bytes: 170 * KB },
      { route: '/b', files: 3, bytes: 135 * KB },
    ]);
  });

  it('acusa só o que passa do limite da rota (padrão ou dívida registrada)', () => {
    expect(overLimit(rows, 150).map((r: { route: string }) => r.route)).toEqual(['/a']);
    expect(overLimit(rows, 150, { routes: { '/a': 175 } })).toEqual([]);
    expect(overLimit(rows, 150, { routes: { '/a': 165 } }).map((r: { route: string }) => r.route)).toEqual(['/a']);
    expect(limitFor('/b', { routes: { '/a': 175 } }, 150)).toBe(150);
  });

  it('a dívida registra só as rotas acima do padrão, com teto arredondado de 5 em 5 KB', () => {
    expect(buildBudget(rows, 150)).toEqual({ limitKb: 150, routes: { '/a': 170 } });
    expect(buildBudget([{ route: '/x', files: 1, bytes: 171.2 * KB }], 150).routes).toEqual({ '/x': 175 });
  });
});
