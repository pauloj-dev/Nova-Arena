/**
 * Tema da arte de resultado (issue #50). A arte usa só estilos em linha e flexbox, que é o que o
 * `next/og` (Satori) aceita — em B2 este mesmo componente gera a imagem no servidor. Por isso as
 * cores não vêm de classes: vêm deste objeto, sempre a partir dos tokens "Nova Green".
 *
 * - Na tela: `CSS_THEME`, com `var(--token)`.
 * - Para exportar (e no servidor): `resolveTheme()`, com os valores finais lidos dos tokens.
 */
export interface ArtTheme {
  bgFrom: string;
  bgMid: string;
  bgTo: string;
  text: string;
  textSoft: string;
  brand: string;
  gold: string;
  silver: string;
  bronze: string;
  ink: string;
  fontDisplay: string;
  fontBody: string;
}

const COLOR_TOKENS: Record<Exclude<keyof ArtTheme, 'fontDisplay' | 'fontBody'>, string> = {
  bgFrom: '--color-primary-900',
  bgMid: '--color-primary-700',
  bgTo: '--color-primary-600',
  text: '--color-white',
  textSoft: '--color-primary-100',
  brand: '--color-primary-500',
  gold: '--color-gold-400',
  silver: '--color-silver-300',
  bronze: '--color-bronze-600',
  ink: '--color-gray-900',
};
const FONT_TOKENS = { fontDisplay: '--font-display', fontBody: '--font-body' } as const;

export const CSS_THEME: ArtTheme = {
  ...(Object.fromEntries(Object.entries(COLOR_TOKENS).map(([key, token]) => [key, `var(${token})`])) as Record<keyof typeof COLOR_TOKENS, string>),
  fontDisplay: `var(${FONT_TOKENS.fontDisplay})`,
  fontBody: `var(${FONT_TOKENS.fontBody})`,
};

/** Lê os valores finais dos tokens no navegador (cores e famílias de fonte já resolvidas). */
export function resolveTheme(doc: Document = document): ArtTheme {
  const probe = doc.createElement('span');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  doc.body.appendChild(probe);
  try {
    const out = { ...CSS_THEME };
    for (const [key, token] of Object.entries(COLOR_TOKENS) as [keyof typeof COLOR_TOKENS, string][]) {
      probe.style.color = `var(${token})`;
      out[key] = getComputedStyle(probe).color || CSS_THEME[key];
    }
    for (const [key, token] of Object.entries(FONT_TOKENS) as [keyof typeof FONT_TOKENS, string][]) {
      probe.style.fontFamily = `var(${token})`;
      out[key] = getComputedStyle(probe).fontFamily || CSS_THEME[key];
    }
    return out;
  } finally {
    probe.remove();
  }
}

export type ArtFormat = 'landscape' | 'square';
/** Proporções da arte: 1200×630 (link compartilhado) e 1080×1080 (feed). */
export const ART_SIZES: Record<ArtFormat, { width: number; height: number; label: string }> = {
  landscape: { width: 1200, height: 630, label: 'Paisagem · 1200 × 630' },
  square: { width: 1080, height: 1080, label: 'Quadrada · 1080 × 1080' },
};
