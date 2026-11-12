import { describe, expect, it } from 'vitest';
import { passwordStrength } from './passwordStrength';

describe('passwordStrength', () => {
  it('campo vazio não tem força', () => {
    expect(passwordStrength('')).toEqual({ score: 0, label: null, tip: null });
  });

  it('senha curta é fraca, mesmo variada', () => {
    const s = passwordStrength('Ab1!');
    expect(s.label).toBe('fraca');
    expect(s.tip).toMatch(/8 caracteres/);
  });

  it('senha comum ou repetitiva é fraca', () => {
    expect(passwordStrength('12345678').label).toBe('fraca');
    expect(passwordStrength('Senha1234').label).toBe('fraca');
    expect(passwordStrength('aaaaaaaa1').label).toBe('fraca');
    expect(passwordStrength('abababab').label).toBe('fraca');
  });

  it('só letras ou só números é fraca', () => {
    expect(passwordStrength('campeonato').label).toBe('fraca');
    expect(passwordStrength('8642097531').label).toBe('fraca');
  });

  it('letras e números com 8 a 11 caracteres é razoável', () => {
    expect(passwordStrength('arena1234')).toMatchObject({ score: 2, label: 'razoável' });
    expect(passwordStrength('booyah77').label).toBe('razoável');
  });

  it('mais longa ou com três tipos de caractere é boa', () => {
    expect(passwordStrength('Booyah2026').label).toBe('boa');
    expect(passwordStrength('squadalfa2026').label).toBe('boa');
  });

  it('longa e variada é forte, sem dica', () => {
    expect(passwordStrength('Squad-Alfa#2026')).toEqual({ score: 4, label: 'forte', tip: null });
    expect(passwordStrength('MeuSquadAlfa2026').label).toBe('forte');
  });

  it('a força nunca diminui ao acrescentar variedade', () => {
    const base = passwordStrength('quedafinal12').score;
    expect(passwordStrength('QuedaFinal12!').score).toBeGreaterThanOrEqual(base);
  });
});
