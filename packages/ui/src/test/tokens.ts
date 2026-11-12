/**
 * Lê `tokens.css` e resolve as variáveis para um tema e uma área, do mesmo jeito que o navegador
 * faria com `data-theme` e `data-area` no <html>. Usado pelo teste de contraste.
 */
export type Theme = 'light' | 'dark';
export type Area = 'participant' | 'organizer' | 'admin';

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface Rule {
  selectors: string[];
  declarations: Array<[name: string, value: string]>;
}

/** Extrai as regras de primeiro nível (ignora blocos @media). */
export function parseRules(css: string): Rule[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  let depth = 0;
  let selector = '';
  let body = '';
  let skipping = false;
  for (const ch of clean) {
    if (ch === '{') {
      depth += 1;
      if (depth === 1) {
        skipping = selector.trim().startsWith('@');
        body = '';
        continue;
      }
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        if (!skipping) {
          const declarations: Rule['declarations'] = [];
          for (const part of body.split(';')) {
            const index = part.indexOf(':');
            if (index === -1) continue;
            const name = part.slice(0, index).trim();
            if (name.startsWith('--')) declarations.push([name, part.slice(index + 1).trim()]);
          }
          rules.push({ selectors: selector.split(',').map((s) => s.trim()), declarations });
        }
        selector = '';
        continue;
      }
    }
    if (depth === 0) selector += ch;
    else body += ch;
  }
  return rules;
}

function selectorMatches(selector: string, theme: Theme, area: Area): boolean {
  if (selector === ':root') return true;
  const conditions = [...selector.matchAll(/\[data-(theme|area)='([^']+)'\]/g)];
  if (conditions.length === 0) return false;
  return conditions.every(([, attr, value]) => (attr === 'theme' ? value === theme : value === area));
}

/** Variáveis em vigor para o par tema + área, já na ordem da cascata. */
export function tokensFor(css: string, theme: Theme, area: Area): Map<string, string> {
  const vars = new Map<string, string>();
  for (const rule of parseRules(css)) {
    if (!rule.selectors.some((s) => selectorMatches(s, theme, area))) continue;
    for (const [name, value] of rule.declarations) vars.set(name, value);
  }
  return vars;
}

/** Resolve `var(--x, fallback)` até sobrar um valor literal. */
export function resolveVar(vars: Map<string, string>, name: string, seen: string[] = []): string {
  if (seen.includes(name)) throw new Error(`Referência circular em ${name}`);
  const raw = vars.get(name);
  if (raw === undefined) throw new Error(`Token ${name} não existe em tokens.css`);
  return raw.replace(/var\((--[\w-]+)(?:\s*,\s*([^)]+))?\)/g, (_match, ref: string, fallback?: string) =>
    vars.has(ref) ? resolveVar(vars, ref, [...seen, name]) : (fallback ?? ''),
  );
}

export function parseColor(value: string): Rgba {
  const v = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(v)?.[1];
  if (hex && [3, 4, 6, 8].includes(hex.length)) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
    const channel = (i: number) => parseInt(full.slice(i, i + 2), 16);
    return { r: channel(0), g: channel(2), b: channel(4), a: full.length === 8 ? channel(6) / 255 : 1 };
  }
  const fn = /^rgba?\(([^)]+)\)$/.exec(v)?.[1];
  if (fn) {
    const parts = fn.split(/[\s,/]+/).filter(Boolean).map(Number);
    const [r, g, b, a = 1] = parts;
    if (r !== undefined && g !== undefined && b !== undefined && parts.every((n) => Number.isFinite(n))) return { r, g, b, a };
  }
  throw new Error(`Cor não reconhecida: "${value}"`);
}

/** Mistura uma cor translúcida sobre um fundo opaco. */
export function blend(top: Rgba, bottom: Rgba, alpha = top.a): Rgba {
  const mix = (t: number, b: number) => t * alpha + b * (1 - alpha);
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
}

function luminance({ r, g, b }: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Razão de contraste da WCAG 2.x entre duas cores opacas. */
export function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
