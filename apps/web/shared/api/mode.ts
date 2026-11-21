/**
 * Saber se um módulo da API ainda é simulado (MSW) neste ambiente. `NEXT_PUBLIC_API_MOCK`: `all` (padrão),
 * `none` ou lista de módulos (`auth,games`). Usado pelo que não passa por `fetch` (ex.: o login social, que
 * é uma navegação até o provedor e não tem como ser simulado).
 */
export function isModuleMocked(moduleName: string, setting: string = process.env.NEXT_PUBLIC_API_MOCK ?? 'all'): boolean {
  if (setting === 'none') return false;
  if (setting === 'all') return true;
  return setting
    .split(',')
    .map((s) => s.trim())
    .includes(moduleName);
}

/**
 * Há algum módulo simulado? Mesma regra de `isMockEnabled()` de `mocks/handlers`, mas sem importar os handlers:
 * quem decide se a API simulada sobe (`MockGate`, `DevSwitcher`) fica leve e o código do mock só é baixado
 * quando ela é usada (#111: JS inicial ≤ 180 KB por rota).
 */
export function isMockApiEnabled(setting: string = process.env.NEXT_PUBLIC_API_MOCK ?? 'all'): boolean {
  return setting !== 'none';
}
