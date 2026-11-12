import { GameAdminInput } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { buildSeed } from '@/mocks/seed';
import { cleanGameInput, coverFileError, emptyGame, gameToForm, MAX_COVER_BYTES, slugify } from './game-values';

describe('slugify', () => {
  it('gera o endereço a partir do nome', () => {
    expect(slugify('Free Fire MAX')).toBe('free-fire-max');
    expect(slugify('  Árvore & Ação!  ')).toBe('arvore-acao');
    expect(slugify('8 Ball Pool')).toBe('8-ball-pool');
    expect(slugify('***')).toBe('');
  });
});

describe('capa', () => {
  it('aceita imagem de até 5 MB', () => {
    expect(coverFileError({ type: 'image/png', size: MAX_COVER_BYTES })).toBeNull();
  });
  it('recusa o que não é imagem', () => {
    expect(coverFileError({ type: 'application/pdf', size: 10 })).toMatch(/arquivo de imagem/);
  });
  it('recusa imagem acima de 5 MB', () => {
    expect(coverFileError({ type: 'image/jpeg', size: MAX_COVER_BYTES + 1 })).toMatch(/5 MB/);
  });
});

describe('GameAdminInput', () => {
  const valid = () => ({ ...emptyGame(), name: 'Jogo', slug: 'jogo', icon: 'JG', modes: [{ name: 'Solo', teamSize: 1, maxSubs: 0, matchType: 'DUEL' as const, maxLobbySize: null }] });
  const errorsOf = (input: unknown) => {
    const parsed = GameAdminInput.safeParse(input);
    return parsed.success ? {} : Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message]));
  };

  it('aceita os 4 jogos do catálogo como estão', () => {
    for (const game of buildSeed().games) expect(errorsOf(gameToForm(game)), game.name).toEqual({});
  });

  it('o formulário vazio pede nome, endereço e ícone', () => {
    const errors = errorsOf({ ...emptyGame(), modes: [{ ...emptyGame().modes[0], name: 'Solo' }] });
    expect(Object.keys(errors).sort()).toEqual(['icon', 'name', 'slug']);
  });

  it('recusa expressão regular que não compila', () => {
    const input = { ...valid(), requiredAccountFields: [{ key: 'playerId', label: 'ID', pattern: '^[0-9' }] };
    expect(errorsOf(input)).toEqual({ 'requiredAccountFields.0.pattern': 'Esta expressão regular não é válida' });
    expect(errorsOf({ ...valid(), requiredAccountFields: [{ key: 'playerId', label: 'ID', pattern: '^[0-9]{6,12}$' }] })).toEqual({});
    expect(errorsOf({ ...valid(), requiredAccountFields: [{ key: 'playerId', label: 'ID', pattern: '' }] })).toEqual({});
  });

  it('recusa chaves repetidas e chave de estatística que o placar já usa', () => {
    const input = {
      ...valid(),
      requiredAccountFields: [
        { key: 'playerId', label: 'ID' },
        { key: 'playerid', label: 'Outro' },
      ],
      extraStatFields: [
        { key: 'kills', label: 'Kills' },
        { key: 'penalties', label: 'Pênaltis' },
        { key: 'penalties', label: 'Pênaltis de novo' },
      ],
    };
    expect(errorsOf(input)).toEqual({
      'requiredAccountFields.1.key': 'Esta chave já foi usada em outro campo',
      'extraStatFields.0.key': 'Esta chave já é usada pelo placar da partida. Escolha outra',
      'extraStatFields.2.key': 'Esta chave já foi usada em outra estatística',
    });
  });

  it('Battle Royale exige o tamanho da sala; modos não repetem nome', () => {
    const input = {
      ...valid(),
      modes: [
        { name: 'Squad', teamSize: 4, maxSubs: 1, matchType: 'BATTLE_ROYALE' as const, maxLobbySize: null },
        { name: 'squad', teamSize: 4, maxSubs: 1, matchType: 'TEAM_VS_TEAM' as const, maxLobbySize: null },
      ],
    };
    expect(errorsOf(input)).toEqual({ 'modes.0.maxLobbySize': 'Informe quantas equipes cabem na sala', 'modes.1.name': 'Já existe um modo com este nome' });
  });

  it('limpa campos opcionais vazios e a sala de quem não é Battle Royale antes de enviar', () => {
    const parsed = GameAdminInput.parse({
      ...valid(),
      name: '  Jogo  ',
      requiredAccountFields: [{ key: 'playerId', label: ' ID ', placeholder: '', pattern: '  ' }],
      extraStatFields: [{ key: 'penalties', label: 'Pênaltis' }],
      modes: [{ name: ' Solo ', teamSize: 1, maxSubs: 0, matchType: 'DUEL', maxLobbySize: 12 }],
    });
    const clean = cleanGameInput(parsed);
    expect(clean.name).toBe('Jogo');
    expect(clean.requiredAccountFields).toEqual([{ key: 'playerId', label: 'ID' }]);
    expect(clean.extraStatFields).toEqual([{ key: 'penalties', label: 'Pênaltis', when: 'always' }]);
    expect(clean.modes).toEqual([{ name: 'Solo', teamSize: 1, maxSubs: 0, matchType: 'DUEL', maxLobbySize: null }]);
  });
});
