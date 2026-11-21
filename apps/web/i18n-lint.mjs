import i18next from 'eslint-plugin-i18next';

/**
 * Verificação de texto fixo em componente (issue 108): texto entre tags e os atributos que a pessoa lê ou ouve.
 * O resto (href, variant, className…) fica de fora (`exclude: ['.*']` com a lista `include`).
 */
export const I18N_RULE = [
  'error',
  {
    mode: 'jsx-only',
    'jsx-attributes': {
      include: ['aria-label', 'aria-description', 'aria-valuetext', 'aria-roledescription', 'placeholder', 'title', 'alt', 'label', 'description', 'hint', 'helperText', 'emptyText', 'confirmLabel', 'cancelLabel', 'srLabel', 'heading', 'subtitle', 'message', 'text', 'tooltip'],
      exclude: ['.*'],
    },
    // Sinais, números, siglas em caixa alta e emojis não são texto a traduzir.
    words: { exclude: ['[0-9!-/:-@[-`{-~\\s·—–…•×%]+', '[A-Z0-9_-]+', '\\p{Emoji}+'] },
    message: 'Texto de interface fixo: mova para o arquivo de mensagens da área (issue 108, ADR-0004).',
  },
];

export const i18nConfig = {
  files: ['app/**/*.tsx', 'features/**/*.tsx', 'shared/**/*.tsx'],
  ignores: ['**/*.test.tsx', '**/*.stories.tsx'],
  plugins: { i18next },
  rules: { 'i18next/no-literal-string': I18N_RULE },
};
