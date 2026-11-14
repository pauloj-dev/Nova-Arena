/**
 * Cores da identidade Nova Green para e-mail. Cliente de e-mail não lê variáveis CSS, então os valores
 * são copiados do tema claro de `packages/ui/src/styles/tokens.css` — o teste `test/email.test.ts` confere
 * que continuam iguais. Mude lá e aqui juntos.
 */
export const EMAIL_THEME = {
  /** `--bg` */
  bg: '#f8faf9',
  /** `--surface` */
  surface: '#ffffff',
  /** `--border` */
  border: '#e2e8e4',
  /** `--text` */
  text: '#0f172a',
  /** `--text-muted` */
  muted: '#55637a',
  /** `--primary` (botão: texto branco a 5,0:1) */
  primary: '#15803d',
  /** `--primary-soft` */
  primarySoft: '#dcfce7',
  /** `--primary-soft-text` */
  primarySoftText: '#14532d',
  /** `--text-on-accent` */
  onPrimary: '#ffffff',
  /** `--color-primary-500` (o ponto verde da marca) */
  brand: '#22c55e',
} as const;

/** Variável do `tokens.css` de onde cada cor veio (usado pelo teste). */
export const THEME_SOURCE: Record<keyof typeof EMAIL_THEME, string> = {
  bg: '--bg',
  surface: '--surface',
  border: '--border',
  text: '--text',
  muted: '--text-muted',
  primary: '--primary',
  primarySoft: '--primary-soft',
  primarySoftText: '--primary-soft-text',
  onPrimary: '--text-on-accent',
  brand: '--color-primary-500',
};
