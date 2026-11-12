import { describe, expect, it } from 'vitest';
import { resolveFlags } from './useFlag';

describe('resolveFlags', () => {
  it('sem resposta da API valem os padrões (ranking, cadastro e envio ligados; push desligado)', () => {
    expect(resolveFlags(undefined)).toEqual({ ranking: true, publicSignup: true, resultSubmission: true, pushNotifications: false });
  });

  it('a resposta da API vence o padrão, flag a flag', () => {
    const flags = resolveFlags({ ranking: false, pushNotifications: true });
    expect(flags.ranking).toBe(false);
    expect(flags.pushNotifications).toBe(true);
    expect(flags.publicSignup).toBe(true);
  });

  it('flag nova no servidor passa adiante; chave que não existe fica indefinida', () => {
    const flags = resolveFlags({ novaFlag: true });
    expect(flags.novaFlag).toBe(true);
    expect(flags.outra).toBeUndefined();
  });
});
