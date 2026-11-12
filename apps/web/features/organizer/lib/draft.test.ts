import { TournamentDraftInput } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { buildSeed } from '@/mocks/seed';
import { validateDraft } from '../validation';
import { defaultDates, defaultWizardValues, selectableGames, stagesFitMode, templateToValues, toDraftPayload, tournamentToValues, UNNAMED_TOURNAMENT, valuesForValidation, withStageKeys } from './draft';
import { suggestedStages } from './formats';

const seed = buildSeed();
const games = seed.games;
const now = new Date('2026-11-12T15:00:00.000Z');

describe('valores padrão do assistente', () => {
  it('começa em 7 dias e fecha as inscrições na véspera, sempre no futuro', () => {
    const dates = defaultDates(now);
    const start = new Date(dates.startsAt as string).getTime();
    const closes = new Date(dates.registrationClosesAt as string).getTime();
    expect(dates.registrationOpensAt).toBeNull();
    expect(start - closes).toBe(24 * 3600_000);
    expect(closes).toBeGreaterThan(now.getTime());
    expect(start - now.getTime()).toBeGreaterThan(6 * 24 * 3600_000);
  });

  it('com nome e as fases sugeridas, o assistente em branco já pode ser publicado', () => {
    const base = defaultWizardValues(now, selectableGames(games, []));
    const game = games.find((g) => g.id === base.gameId);
    const mode = game?.modes.find((m) => m.id === base.gameModeId);
    const values = { ...base, name: 'Copa de Teste', stages: withStageKeys(suggestedStages({ game, mode, maxParticipants: base.maxParticipants })) };
    expect(validateDraft(valuesForValidation(values), { games, now })).toEqual([]);
  });

  it('só oferece jogos ativos e liberados para a conta', () => {
    const withInactive = games.map((g) => (g.id === 'g_8ball' ? { ...g, active: false } : g));
    expect(selectableGames(withInactive, []).map((g) => g.id)).not.toContain('g_8ball');
    expect(selectableGames(games, ['g_efootball']).map((g) => g.id)).toEqual(['g_efootball']);
    expect(selectableGames(games, null)).toHaveLength(games.length);
  });
});

describe('começar a partir de um modelo', () => {
  it('"FF Squad — Grupos + Final BR" preenche jogo, vagas, regras e as 3 fases', () => {
    const template = seed.templates.find((t) => t.id === 'tpl_ff_grupos_final');
    if (!template) throw new Error('modelo do seed não encontrado');
    const values = templateToValues(template, defaultWizardValues(now, games));
    expect(values).toMatchObject({ gameId: 'g_freefire', gameModeId: 'm_ff_squad', maxParticipants: 48, name: '' });
    expect(values.stages.map((s) => s.format)).toEqual(['GROUPS', 'TEAM_VS_TEAM', 'BATTLE_ROYALE']);
    expect(values.rules).toContain('Regras gerais');
    expect(values.startsAt).not.toBeNull();
    expect(validateDraft(valuesForValidation({ ...values, name: 'Copa do Modelo' }), { games, now })).toEqual([]);
  });
});

describe('corpo do rascunho automático', () => {
  const base = defaultWizardValues(now, games);

  it('sempre passa no contrato da API, mesmo com campos pela metade', () => {
    const messy = { ...base, name: 'ab', streamUrls: ['https://exemplo.com', ' https://youtu.be/abc12345 ', ''], maxParticipants: Number.NaN, prize: 'x'.repeat(3000) };
    const payload = toDraftPayload(messy, 2);
    expect(TournamentDraftInput.safeParse(payload).success).toBe(true);
    expect(payload).not.toHaveProperty('name');
    expect(payload).not.toHaveProperty('maxParticipants');
    expect(payload.streamUrls).toEqual(['https://youtu.be/abc12345']);
    expect(payload.prize).toHaveLength(2000);
    expect(payload.draftStep).toBe(2);
  });

  it('leva o nome válido, as fases e o passo em que a pessoa parou', () => {
    const game = games.find((g) => g.id === 'g_freefire');
    const mode = game?.modes.find((m) => m.id === 'm_ff_squad');
    const stages = withStageKeys(suggestedStages({ game, mode, maxParticipants: 48 })).map((s, i) => (i === 0 ? { ...s, name: '  ' } : s));
    const payload = toDraftPayload({ ...base, name: '  Copa Nova  ', stages }, 9);
    expect(payload.name).toBe('Copa Nova');
    expect(payload.stages?.map((s) => s.name)).toEqual(['Fase 1', 'Grande Final']);
    // A chave local da fase não faz parte do contrato.
    expect(payload.stages?.every((s) => !('key' in s))).toBe(true);
    expect(payload.draftStep).toBe(6);
  });
});

describe('rascunho vindo da API', () => {
  it('o nome provisório da API volta como "sem nome" no assistente', () => {
    const t = seed.tournaments.find((x) => x.id === 'tn_cr_2v2')!;
    const base = { ...t, name: UNNAMED_TOURNAMENT } as unknown as Parameters<typeof tournamentToValues>[0];
    const values = tournamentToValues(base);
    expect(values.name).toBe('');
    expect(toDraftPayload(values, 0)).not.toHaveProperty('name');
  });
});

describe('stagesFitMode', () => {
  it('fases de Free Fire Squad não servem para Clash Royale 1v1', () => {
    const ff = games.find((g) => g.id === 'g_freefire')!;
    const squad = ff.modes.find((m) => m.id === 'm_ff_squad')!;
    const cr = games.find((g) => g.id === 'g_clashroyale')!;
    const stages = suggestedStages({ game: ff, mode: squad, maxParticipants: 48 });
    expect(stagesFitMode(stages, ff, squad)).toBe(true);
    expect(stagesFitMode(stages, cr, cr.modes[0]!)).toBe(false);
    expect(stagesFitMode([], cr, cr.modes[0]!)).toBe(true);
  });
});
