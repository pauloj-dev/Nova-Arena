import base from '@nova/config/eslint';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  ...base,
  { ignores: ['test-results/**', 'playwright-report/**'] },
  jsxA11y.flatConfigs.recommended,
  { plugins: { 'react-hooks': reactHooks }, rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' } },
  // Scripts de Node (ex.: check-colors.mjs).
  { files: ['scripts/**/*.mjs'], languageOptions: { globals: { process: 'readonly', console: 'readonly' } } },
];
