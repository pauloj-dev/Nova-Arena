// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { blend, contrast, parseColor, resolveVar, tokensFor, type Area, type Rgba, type Theme } from '../test/tokens';

const css = readFileSync(join(import.meta.dirname, 'tokens.css'), 'utf8');

const themes: Theme[] = ['light', 'dark'];
const areas: Area[] = ['participant', 'organizer', 'admin'];

/** Uma cor da frente: token puro ou token translúcido aplicado sobre outro (ex.: linha selecionada). */
type Layer = string | { token: string; alpha: number; over: string };

interface Pair {
  fg: string;
  bg: Layer;
  /** Onde o par aparece nos componentes. */
  where: string;
}

const AA_TEXT = 4.5;
const AA_UI = 3;

/** Texto sobre fundo: contraste mínimo de 4,5:1. */
const textPairs: Pair[] = [
  // Texto principal
  { fg: '--text', bg: '--bg', where: 'texto sobre o fundo da página; Button ghost; Tabs ativa; Stepper' },
  { fg: '--text', bg: '--surface', where: 'Card, Modal, Drawer, campos, Button secondary, Toast info, DataTable' },
  { fg: '--text', bg: '--surface-2', where: 'Button secondary em hover' },
  { fg: '--text', bg: '--neutral-soft', where: 'Button ghost em hover; passo do Stepper em hover' },
  { fg: '--text', bg: { token: '--accent-soft', alpha: 0.4, over: '--surface' }, where: 'linha selecionada da DataTable' },

  // Texto secundário
  { fg: '--text-muted', bg: '--bg', where: 'dicas dos campos, Tabs inativas, Stepper, paginação' },
  { fg: '--text-muted', bg: '--surface', where: 'placeholder, descrição do Modal, EmptyState, Progress, cartões da DataTable' },
  { fg: '--text-muted', bg: '--surface-2', where: 'cabeçalho da DataTable' },
  { fg: '--text-muted', bg: '--neutral-soft', where: 'botão Fechar em hover; passo do Stepper em hover' },
  { fg: '--text-muted', bg: { token: '--accent-soft', alpha: 0.4, over: '--surface' }, where: 'texto secundário em linha selecionada' },

  // Ação (muda com a área)
  { fg: '--text-on-accent', bg: '--accent', where: 'Button primary; Checkbox marcado; passo concluído do Stepper' },
  { fg: '--text-on-accent', bg: '--accent-hover', where: 'Button primary em hover' },
  { fg: '--text-on-accent', bg: '--primary', where: 'acento padrão (participante)' },
  { fg: '--text-on-accent', bg: '--primary-hover', where: 'acento padrão em hover' },
  { fg: '--text-on-accent', bg: '--danger', where: 'Button danger' },
  { fg: '--text-on-accent', bg: '--danger-hover', where: 'Button danger em hover' },
  { fg: '--primary-text', bg: '--bg', where: 'links e destaques em texto' },
  { fg: '--primary-text', bg: '--surface', where: 'links e destaques em texto dentro de cartões' },
  { fg: '--danger', bg: '--bg', where: 'mensagem de erro e asterisco dos campos' },
  { fg: '--danger', bg: '--surface', where: 'mensagem de erro dos campos dentro de Card/Modal' },

  // Pares "soft" (Badge, StatusPill, Toast, Avatar, EmptyState, ErrorState)
  { fg: '--primary-soft-text', bg: '--primary-soft', where: 'Badge primary; Toast de sucesso' },
  { fg: '--accent-soft-text', bg: '--accent-soft', where: 'Badge accent; Avatar; passo atual; barra de seleção da DataTable' },
  { fg: '--danger-soft-text', bg: '--danger-soft', where: 'Badge danger; Toast de erro; ErrorState' },
  { fg: '--danger-soft-text', bg: '--surface', where: 'botão "Tentar novamente" do ErrorState em hover' },
  { fg: '--warning-soft-text', bg: '--warning-soft', where: 'Badge warning' },
  { fg: '--info-soft-text', bg: '--info-soft', where: 'Badge info' },
  { fg: '--neutral-soft-text', bg: '--neutral-soft', where: 'Badge neutral' },
  { fg: '--gold-soft-text', bg: '--gold-soft', where: 'Badge gold' },

  // Dourado e barra da área
  { fg: '--gold-text', bg: '--color-gold-400', where: 'Button gold (início do gradiente)' },
  { fg: '--gold-text', bg: '--color-warning-500', where: 'Button gold (fim do gradiente)' },
  { fg: '--chrome-text', bg: '--chrome-bg', where: 'cabeçalho e menu lateral da área' },
];

/** Bordas de controles, indicadores e ícones grandes: contraste mínimo de 3:1. */
const uiPairs: Pair[] = [
  { fg: '--border-strong', bg: '--surface', where: 'borda de Input, Textarea, Select, Checkbox e Button secondary' },
  { fg: '--border-strong', bg: '--bg', where: 'borda tracejada do EmptyState e do vazio da DataTable' },
  { fg: '--border-strong', bg: '--neutral-soft', where: 'borda e botão deslizante do Switch desligado' },
  { fg: '--accent', bg: '--surface', where: 'anel de foco; Checkbox e Switch ligados; aba ativa' },
  { fg: '--accent', bg: '--bg', where: 'anel de foco e aba ativa sobre o fundo da página' },
  { fg: '--accent', bg: '--neutral-soft', where: 'preenchimento do Progress e da barra do Stepper' },
  { fg: '--accent', bg: '--accent-soft', where: 'borda do passo atual do Stepper' },
  { fg: '--surface', bg: '--accent', where: 'botão deslizante do Switch ligado' },
  { fg: '--danger', bg: '--surface', where: 'borda do campo com erro' },
  { fg: '--danger', bg: '--danger-soft', where: 'borda do Toast de erro e do botão do ErrorState' },
  { fg: '--primary', bg: '--primary-soft', where: 'borda do Toast de sucesso' },
];

function makeResolver(theme: Theme, area: Area) {
  const vars = tokensFor(css, theme, area);
  const color = (token: string): Rgba => {
    const c = parseColor(resolveVar(vars, token));
    if (c.a !== 1) throw new Error(`${token} é translúcido: informe sobre qual fundo ele é aplicado`);
    return c;
  };
  return (layer: Layer): Rgba => (typeof layer === 'string' ? color(layer) : blend(color(layer.token), color(layer.over), layer.alpha));
}

function describeLayer(layer: Layer): string {
  return typeof layer === 'string' ? layer : `${layer.token} a ${layer.alpha * 100}% sobre ${layer.over}`;
}

describe('contraste AA dos tokens', () => {
  it('lê os dois temas e as três áreas de tokens.css', () => {
    expect(resolveVar(tokensFor(css, 'light', 'participant'), '--accent')).toBe(resolveVar(tokensFor(css, 'light', 'participant'), '--primary'));
    expect(resolveVar(tokensFor(css, 'dark', 'participant'), '--bg')).not.toBe(resolveVar(tokensFor(css, 'light', 'participant'), '--bg'));
    expect(resolveVar(tokensFor(css, 'light', 'organizer'), '--accent')).not.toBe(resolveVar(tokensFor(css, 'light', 'participant'), '--accent'));
    expect(resolveVar(tokensFor(css, 'dark', 'admin'), '--accent')).not.toBe(resolveVar(tokensFor(css, 'light', 'admin'), '--accent'));
  });

  it('calcula a razão de contraste da WCAG', () => {
    const black = { r: 0, g: 0, b: 0, a: 1 };
    const white = { r: 255, g: 255, b: 255, a: 1 };
    const gray = { r: 119, g: 119, b: 119, a: 1 };
    expect(contrast(black, white)).toBeCloseTo(21, 5);
    expect(contrast(gray, white)).toBeCloseTo(4.48, 2);
    expect(parseColor('#FFF')).toEqual(white); // check-colors-ignore
    expect(parseColor('#777777')).toEqual(gray); // check-colors-ignore
    expect(parseColor('rgba(0, 0, 0, 0.5)')).toEqual({ ...black, a: 0.5 }); // check-colors-ignore
    expect(blend({ ...black, a: 0.5 }, white)).toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 1 });
  });

  for (const theme of themes) {
    for (const area of areas) {
      describe(`tema ${theme} · área ${area}`, () => {
        const resolve = makeResolver(theme, area);

        it.each(textPairs.map((p) => [p.fg, describeLayer(p.bg), p] as const))('texto %s sobre %s ≥ 4,5:1', (_fg, _bg, pair) => {
          const ratio = contrast(resolve(pair.fg), resolve(pair.bg));
          expect(ratio, `${pair.where} (${ratio.toFixed(2)}:1)`).toBeGreaterThanOrEqual(AA_TEXT);
        });

        it.each(uiPairs.map((p) => [p.fg, describeLayer(p.bg), p] as const))('controle %s sobre %s ≥ 3:1', (_fg, _bg, pair) => {
          const ratio = contrast(resolve(pair.fg), resolve(pair.bg));
          expect(ratio, `${pair.where} (${ratio.toFixed(2)}:1)`).toBeGreaterThanOrEqual(AA_UI);
        });
      });
    }
  }
});
