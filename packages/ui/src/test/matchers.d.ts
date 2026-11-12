/**
 * Tipos dos matchers do jest-dom (`toHaveFocus`, `toBeDisabled`…) para o Vitest 5.
 * O `@testing-library/jest-dom/vitest` ainda declara `Assertion<T>`, que no Vitest 5 passou a ser
 * `Assertion<R, T>`; por isso a declaração é feita aqui, na interface `Matchers`, que é o ponto de extensão atual.
 */
import 'vitest';
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-object-type
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> extends TestingLibraryMatchers<unknown, R> {}
}
