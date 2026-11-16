import { describe, expect, it } from 'vitest';
import { B1_REAL_MODULES, enabledHandlers, modules, previewMockSetting } from './index';

describe('mock por ambiente (issue #81)', () => {
  it('todo módulo do B1 existe no registro do mock', () => {
    const names = modules.map((m) => m.moduleName);
    for (const name of B1_REAL_MODULES) expect(names, name).toContain(name);
  });

  it('no preview só ficam simulados os módulos do B2', () => {
    const setting = previewMockSetting().split(',');
    expect(setting.length).toBeGreaterThan(0);
    for (const name of B1_REAL_MODULES) expect(setting).not.toContain(name);
    expect(setting).toEqual(expect.arrayContaining(['competition', 'submissions', 'notifications']));
    // Os handlers ativos no preview não atendem nenhuma rota do núcleo.
    const paths = enabledHandlers(previewMockSetting()).map((h) => h.info.path.toString());
    expect(paths.some((p) => p.endsWith('/auth/login') || p.endsWith('/tournaments/:id/registrations'))).toBe(false);
  });
});
