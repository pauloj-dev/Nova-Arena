import { describe, expect, it } from 'vitest';
import { BASE_TIME_ZONES, gameAccountDefaults, gameAccountSchema, locationLabel, socialHref, timeZoneOptions } from './profileLib';

const AT = new Date('2026-11-12T12:00:00Z');

describe('timeZoneOptions', () => {
  it('traz os fusos do Brasil, Lisboa e UTC com nome legível', () => {
    const options = timeZoneOptions([], AT);
    expect(options.map((o) => o.value)).toEqual([...BASE_TIME_ZONES]);
    expect(options[0]).toEqual({ value: 'America/Sao_Paulo', label: 'Horário de Brasília' });
    expect(options.find((o) => o.value === 'America/Rio_Branco')?.label).toBe('Horário do Acre');
    expect(options.find((o) => o.value === 'UTC')?.label).toBe('UTC');
  });
  it('acrescenta o fuso do navegador quando ele não está na lista, sem repetir', () => {
    const options = timeZoneOptions(['America/Fortaleza', 'America/Fortaleza', 'America/Sao_Paulo', null, undefined], AT);
    expect(options).toHaveLength(BASE_TIME_ZONES.length + 1);
    expect(options.at(-1)).toEqual({ value: 'America/Fortaleza', label: 'Fortaleza — horário de Brasília' });
  });
  it('fuso desconhecido aparece com a cidade e o deslocamento', () => {
    const last = timeZoneOptions(['America/New_York'], AT).at(-1);
    expect(last?.value).toBe('America/New_York');
    expect(last?.label).toMatch(/^New York — /);
  });
});

describe('gameAccountSchema', () => {
  const fields = [
    { key: 'playerId', label: 'ID Free Fire', pattern: '^[0-9]{6,12}$' },
    { key: 'nick', label: 'Nick no jogo' },
  ];
  const schema = gameAccountSchema(fields);

  it('aceita os campos preenchidos no formato do jogo e tira espaços das pontas', () => {
    const result = schema.safeParse({ fields: { playerId: ' 1234567890 ', nick: 'Alfa' } });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ fields: { playerId: '1234567890', nick: 'Alfa' } });
  });
  it('exige todos os campos do jogo', () => {
    const result = schema.safeParse({ fields: { playerId: '1234567890', nick: '   ' } });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ path: ['fields', 'nick'], message: 'Preencha este campo' });
  });
  it('confere o formato e cita o nome do campo', () => {
    const result = schema.safeParse({ fields: { playerId: 'abc', nick: 'Alfa' } });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ path: ['fields', 'playerId'], message: 'Confira o formato de "ID Free Fire"' });
  });
  it('padrão inválido no cadastro do jogo não trava o formulário', () => {
    const broken = gameAccountSchema([{ key: 'tag', label: 'Tag', pattern: '([' }]);
    expect(broken.safeParse({ fields: { tag: 'qualquer' } }).success).toBe(true);
  });
  it('monta os valores iniciais com o que já está salvo', () => {
    expect(gameAccountDefaults(fields, undefined)).toEqual({ playerId: '', nick: '' });
    expect(gameAccountDefaults(fields, { playerId: '123456', outro: 'x' })).toEqual({ playerId: '123456', nick: '' });
  });
});

describe('socialHref', () => {
  it('só vira link o que for URL https', () => {
    expect(socialHref('https://twitch.tv/camila')).toBe('https://twitch.tv/camila');
    expect(socialHref('  https://youtube.com/@nova  ')).toBe('https://youtube.com/@nova');
  });
  it('usuário, http e esquemas perigosos ficam como texto', () => {
    expect(socialHref('@camila')).toBeNull();
    expect(socialHref('camila#1234')).toBeNull();
    expect(socialHref('http://exemplo.com')).toBeNull();
    expect(socialHref('javascript:alert(1)')).toBeNull();
    expect(socialHref('')).toBeNull();
    expect(socialHref(undefined)).toBeNull();
  });
});

describe('locationLabel', () => {
  it('junta estado e país, ignorando o que falta', () => {
    expect(locationLabel('MG', 'Brasil')).toBe('MG, Brasil');
    expect(locationLabel(null, 'Brasil')).toBe('Brasil');
    expect(locationLabel(' ', null)).toBeNull();
  });
});
