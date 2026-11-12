import { describe, expect, it } from 'vitest';
import { safeNext, withNext } from './safeNext';

describe('safeNext', () => {
  it('aceita caminhos internos, com busca e âncora', () => {
    expect(safeNext('/minha-conta')).toBe('/minha-conta');
    expect(safeNext('/campeonatos?game=free-fire&slots=available')).toBe('/campeonatos?game=free-fire&slots=available');
    expect(safeNext('/c/copa-nova-ff-squad#regulamento')).toBe('/c/copa-nova-ff-squad#regulamento');
    expect(safeNext('/convite/convite-admin-valido')).toBe('/convite/convite-admin-valido');
  });

  it('cai no padrão quando não há destino', () => {
    expect(safeNext(null)).toBe('/');
    expect(safeNext(undefined)).toBe('/');
    expect(safeNext('')).toBe('/');
    expect(safeNext(null, '/minha-conta')).toBe('/minha-conta');
  });

  it('recusa qualquer coisa que leve para fora do site', () => {
    for (const evil of [
      'https://evil.example.com',
      'http://evil.example.com/entrar',
      '//evil.example.com',
      '///evil.example.com',
      '/\\evil.example.com',
      '\\\\evil.example.com',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'evil.example.com',
      'minha-conta',
      '/\tevil.example.com',
      '/caminho\\outro',
    ]) {
      expect(safeNext(evil), evil).toBe('/');
    }
  });
});

describe('withNext', () => {
  it('só acrescenta next quando há destino diferente do padrão', () => {
    expect(withNext('/cadastro', null)).toBe('/cadastro');
    expect(withNext('/cadastro', '/')).toBe('/cadastro');
    expect(withNext('/cadastro', '/convite/abc')).toBe('/cadastro?next=%2Fconvite%2Fabc');
    expect(withNext('/verificar-email?token=t1', '/minha-conta')).toBe('/verificar-email?token=t1&next=%2Fminha-conta');
  });

  it('não repassa destino externo', () => {
    expect(withNext('/entrar', 'https://evil.example.com')).toBe('/entrar');
  });
});
