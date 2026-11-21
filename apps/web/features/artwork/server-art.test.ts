import { describe, expect, it } from 'vitest';
import { championsArtProps, SERVER_THEME, siteLabelFor } from './server-art';

describe('arte de resultado no servidor (issue #89)', () => {
  it('monta o pódio, a data em Brasília e o endereço sem protocolo', () => {
    const props = championsArtProps(
      { name: 'Copa Nova FF', slug: 'copa-nova-ff', gameName: 'Free Fire', gameIcon: '🔥' },
      { tournamentId: 't1', finishedAt: '2026-11-21T02:30:00.000Z', places: [{ place: 2, registrationId: 'r2', name: 'Bravo', tag: null, logoUrl: null }, { place: 1, registrationId: 'r1', name: 'Alfa', tag: 'ALF', logoUrl: null }] },
      'landscape',
    );
    // 02:30 UTC ainda é dia 20 em Brasília.
    expect(props.dateLabel).toBe('20/11/2026');
    expect(props.places).toEqual([{ place: 2, name: 'Bravo', tag: null }, { place: 1, name: 'Alfa', tag: 'ALF' }]);
    expect(props.theme).toBe(SERVER_THEME);
    expect(siteLabelFor('copa', 'https://staging.novaarena.gg')).toBe('staging.novaarena.gg/c/copa');
    expect(siteLabelFor('copa', 'não é url')).toBe('novaarena.gg/c/copa');
  });

  it('o tema do servidor só tem cores finais (o gerador não lê variáveis CSS)', () => {
    for (const [key, value] of Object.entries(SERVER_THEME)) if (!key.startsWith('font')) expect(value, key).toMatch(/^#[0-9a-f]{6}$/);
  });
});
