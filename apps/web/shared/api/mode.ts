/**
 * Saber se um módulo da API ainda é simulado (MSW) neste ambiente. `NEXT_PUBLIC_API_MOCK`: `all`,
 * `none` ou lista de módulos (`auth,games`). Em builds de produção, mocks são sempre desligados; em dev/testes
 * usam `all` por padrão.
 * Usado pelo que não passa por `fetch` (ex.: o login social, que
 * é uma navegação até o provedor e não tem como ser simulado).
 */
/**
 * Há algo simulado neste ambiente? Leve de propósito (não importa os handlers): com `NEXT_PUBLIC_API_MOCK=none`
 * (preview, staging e produção) o MSW e o banco simulado nunca entram no JavaScript carregado pela página — só no
 * pedaço que o `MockGate` importa sob demanda.
 */
export function apiMockSetting(
  setting: string | undefined = process.env.NEXT_PUBLIC_API_MOCK,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): string {
  if (nodeEnv === 'production') return 'none';
  const configured = setting?.trim();
  if (configured) return configured;
  return 'all';
}

export function isMockEnabled(setting?: string): boolean {
  return apiMockSetting(setting) !== 'none';
}

export function isModuleMocked(moduleName: string, setting?: string): boolean {
  const mode = apiMockSetting(setting);
  if (mode === 'none') return false;
  if (mode === 'all') return true;
  return mode
    .split(',')
    .map((s) => s.trim())
    .includes(moduleName);
}

/** Mesmo que `isMockEnabled()`: nome usado pelo `MockGate` e pelas telas do protótipo (#111). */
export const isMockApiEnabled = isMockEnabled;
