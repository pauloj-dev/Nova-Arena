import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Config base para os pacotes TypeScript sem React. */
export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'storybook-static/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
