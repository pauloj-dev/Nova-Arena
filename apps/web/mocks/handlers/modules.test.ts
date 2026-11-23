import { describe, expect, it } from 'vitest';
import { B1_REAL_MODULES, B2_REAL_MODULES, enabledHandlers, mockSetting, modules, previewMockSetting, REAL_MODULES } from './index';

describe('mock por ambiente (issues #81 e #102)', () => {
  it('todo módulo com API real existe no registro do mock (e nenhum ficou de fora da lista)', () => {
    const names = modules.map((m) => m.moduleName);
    for (const name of REAL_MODULES) expect(names, name).toContain(name);
    expect(names.filter((n) => !REAL_MODULES.includes(n))).toEqual([]);
    expect(B1_REAL_MODULES.filter((n) => (B2_REAL_MODULES as readonly string[]).includes(n))).toEqual([]);
  });

  it('preview e staging usam a API real em todos os módulos: `none`, sem nenhum handler do MSW', () => {
    expect(previewMockSetting()).toBe('none');
    expect(enabledHandlers(previewMockSetting())).toEqual([]);
  });

  it('o protótipo local continua todo simulado por padrão (sem a variável)', () => {
    const before = process.env.NEXT_PUBLIC_API_MOCK;
    delete process.env.NEXT_PUBLIC_API_MOCK;
    try {
      expect(mockSetting()).toBe('all');
      expect(enabledHandlers().length).toBe(modules.flatMap((m) => m.handlers).length);
    } finally {
      if (before !== undefined) process.env.NEXT_PUBLIC_API_MOCK = before;
    }
  });
});
