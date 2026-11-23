/**
 * Saber se um módulo da API ainda é simulado (MSW) neste ambiente. `NEXT_PUBLIC_API_MOCK`: `all` (padrão),
 * `none` ou lista de módulos (`auth,games`). Usado pelo que não passa por `fetch` (ex.: o login social, que
 * é uma navegação até o provedor e não tem como ser simulado).
 */
/**
 * Há algo simulado neste ambiente? Leve de propósito (não importa os handlers): com `NEXT_PUBLIC_API_MOCK=none`
 * (preview, staging e produção) o MSW e o banco simulado nunca entram no JavaScript carregado pela página — só no
 * pedaço que o `MockGate` importa sob demanda.
 */
export function isMockEnabled(setting: string = process.env.NEXT_PUBLIC_API_MOCK ?? 'all'): boolean {
  return setting !== 'none';
}

export function isModuleMocked(moduleName: string, setting: string = process.env.NEXT_PUBLIC_API_MOCK ?? 'all'): boolean {
  if (setting === 'none') return false;
  if (setting === 'all') return true;
  return setting
    .split(',')
    .map((s) => s.trim())
    .includes(moduleName);
}

/** Mesmo que `isMockEnabled()`: nome usado pelo `MockGate` e pelas telas do protótipo (#111). */
export const isMockApiEnabled = isMockEnabled;
