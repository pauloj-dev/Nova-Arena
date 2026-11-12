import type { Game, GameMode, StageFormat } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { buildSeed } from '@/mocks/seed';
import { validateStages } from '../validation';
import {
  changeStageFormat,
  compatibleScoringModels,
  configFieldsFor,
  defaultMaxParticipants,
  defaultQualification,
  defaultStage,
  defaultStageConfig,
  FORMAT_INFO,
  formatAvailability,
  groupModeAvailability,
  qualificationTypesFor,
  STAGE_FORMAT_ORDER,
  stageMatchType,
  suggestedStages,
} from './formats';

const games = buildSeed().games;
const game = (id: string) => games.find((g) => g.id === id) as Game;
const mode = (g: Game, id: string) => g.modes.find((m) => m.id === id) as GameMode;
const ff = game('g_freefire');
const ffSquad = mode(ff, 'm_ff_squad');
const ffSolo = mode(ff, 'm_ff_solo');
const ffDuo = mode(ff, 'm_ff_duo');
const ffCs = mode(ff, 'm_ff_cs');
const cr = game('g_clashroyale');
const cr1v1 = mode(cr, 'm_cr_1v1');
const cr2v2 = mode(cr, 'm_cr_2v2');

describe('os 7 formatos', () => {
  it('todos têm nome e explicação em pt-BR', () => {
    expect(STAGE_FORMAT_ORDER).toHaveLength(7);
    for (const format of STAGE_FORMAT_ORDER) {
      expect(FORMAT_INFO[format].name.length).toBeGreaterThan(3);
      expect(FORMAT_INFO[format].description.length).toBeGreaterThan(20);
    }
  });

  it('cada formato mostra só os campos que usa', () => {
    expect(configFieldsFor('SINGLE_ELIM', { groupMode: 'DUEL' })).toEqual(['bestOf', 'thirdPlace']);
    expect(configFieldsFor('TEAM_VS_TEAM', { groupMode: 'DUEL' })).toEqual(['bestOf', 'thirdPlace']);
    expect(configFieldsFor('DOUBLE_ELIM', { groupMode: 'DUEL' })).toEqual(['bestOf', 'grandFinalReset']);
    expect(configFieldsFor('ROUND_ROBIN', { groupMode: 'DUEL' })).toEqual(['bestOf', 'doubleRound']);
    expect(configFieldsFor('SWISS', { groupMode: 'DUEL' })).toEqual(['rounds', 'bestOf']);
    expect(configFieldsFor('BATTLE_ROYALE', { groupMode: 'DUEL' })).toEqual(['drops', 'lobbySize', 'killsPerPlayer', 'lastDropMultiplier']);
    expect(configFieldsFor('GROUPS', { groupMode: 'DUEL' })).toEqual(['groupCount', 'groupMode', 'bestOf', 'doubleRound']);
    expect(configFieldsFor('GROUPS', { groupMode: 'BATTLE_ROYALE' })).toEqual(['groupCount', 'groupMode', 'drops', 'lobbySize', 'killsPerPlayer', 'lastDropMultiplier']);
  });
});

describe('valores padrão por formato', () => {
  it('seguem a ADR-0001: sala de 12, kills por equipe, sem multiplicador', () => {
    const br = defaultStageConfig('BATTLE_ROYALE', ffSquad);
    expect(br).toMatchObject({ drops: 3, lobbySize: 12, killsPerPlayer: false, lastDropMultiplier: 1 });
  });

  it('a sala padrão nunca passa do limite do modo', () => {
    expect(defaultStageConfig('BATTLE_ROYALE', { matchType: 'BATTLE_ROYALE', maxLobbySize: 8 }).lobbySize).toBe(8);
    expect(defaultStageConfig('BATTLE_ROYALE', ffSolo).lobbySize).toBe(12);
  });

  it('duelos começam em MD1; Equipe x Equipe em MD3', () => {
    expect(defaultStageConfig('SINGLE_ELIM').bestOf).toBe(1);
    expect(defaultStageConfig('DOUBLE_ELIM')).toMatchObject({ bestOf: 1, grandFinalReset: true });
    expect(defaultStageConfig('ROUND_ROBIN')).toMatchObject({ bestOf: 1, doubleRound: false });
    expect(defaultStageConfig('SWISS')).toMatchObject({ rounds: 5, bestOf: 1 });
    expect(defaultStageConfig('TEAM_VS_TEAM')).toMatchObject({ bestOf: 3, thirdPlace: false });
  });

  it('grupos seguem o modo do jogo: quedas no BR, duelos nos outros', () => {
    expect(defaultStageConfig('GROUPS', ffSquad)).toMatchObject({ groupCount: 4, groupMode: 'BATTLE_ROYALE', drops: 3 });
    expect(defaultStageConfig('GROUPS', cr1v1)).toMatchObject({ groupCount: 4, groupMode: 'DUEL' });
  });

  it('a repescagem vem desligada em toda regra de classificação padrão', () => {
    for (const format of STAGE_FORMAT_ORDER) expect(defaultQualification(format).repechage).toBe(0);
    expect(defaultQualification('GROUPS')).toEqual({ type: 'TOP_N_PER_GROUP', n: 2, repechage: 0 });
    expect(defaultQualification('SINGLE_ELIM').type).toBe('WINNERS');
    expect(defaultQualification('SWISS').type).toBe('TOP_N_OVERALL');
  });

  it('fase nova já vem com o modelo de pontuação padrão do jogo e o desempate dele', () => {
    const stage = defaultStage('BATTLE_ROYALE', { game: ff, mode: ffSquad });
    const model = ff.scoringModels.find((m) => m.id === 'sm_ff_padrao');
    expect(stage).toMatchObject({ name: 'Quedas', scoringModelId: 'sm_ff_padrao', seeding: 'RANDOM', qualification: null });
    expect(stage.tiebreakers).toEqual(model?.tiebreakers);
    expect(defaultStage('TEAM_VS_TEAM', { game: ff, mode: ffSquad }).scoringModelId).toBe('sm_ff_cs');
    expect(defaultStage('SINGLE_ELIM', { game: cr, mode: cr2v2 }).scoringModelId).toBe('sm_cr_2v2');
  });

  it('fase que não é a última nasce com regra de classificação', () => {
    expect(defaultStage('GROUPS', { game: ff, mode: ffSquad }, { isLast: false }).qualification).toEqual({ type: 'TOP_N_PER_GROUP', n: 2, repechage: 0 });
  });

  it('vagas padrão: 4 salas no BR, 16 nos duelos', () => {
    expect(defaultMaxParticipants(ffSquad)).toBe(48);
    expect(defaultMaxParticipants(cr1v1)).toBe(16);
    expect(defaultMaxParticipants(null)).toBe(16);
  });
});

describe('compatibilidade com o modo do jogo', () => {
  const available = (g: Game, m: GameMode) => STAGE_FORMAT_ORDER.filter((f) => formatAvailability(f, g, m).available);

  it('Battle Royale só para modos BR, com o motivo', () => {
    const result = formatAvailability('BATTLE_ROYALE', cr, cr1v1);
    expect(result.available).toBe(false);
    expect(result.reason).toContain('Battle Royale só serve');
  });

  it('modos de duelo aceitam os formatos de duelo', () => {
    expect(available(cr, cr1v1)).toEqual(['SINGLE_ELIM', 'DOUBLE_ELIM', 'GROUPS', 'ROUND_ROBIN', 'SWISS']);
    expect(available(cr, cr2v2)).toEqual(['SINGLE_ELIM', 'DOUBLE_ELIM', 'GROUPS', 'ROUND_ROBIN', 'SWISS', 'TEAM_VS_TEAM']);
    expect(available(ff, ffCs)).toContain('TEAM_VS_TEAM');
  });

  it('Free Fire Squad aceita mata-mata 4v4 porque o jogo tem Contra Squad (PRD §10.4)', () => {
    expect(available(ff, ffSquad)).toEqual(STAGE_FORMAT_ORDER);
  });

  it('Free Fire Solo e Duo não têm duelo: só BR e grupos', () => {
    expect(available(ff, ffSolo)).toEqual(['GROUPS', 'BATTLE_ROYALE']);
    expect(available(ff, ffDuo)).toEqual(['GROUPS', 'BATTLE_ROYALE']);
    expect(formatAvailability('SINGLE_ELIM', ff, ffDuo).reason).toContain('equipes de 2');
    expect(formatAvailability('TEAM_VS_TEAM', ff, ffSolo).reason).toContain('individual');
  });

  it('modo do grupo: quedas só em modo BR', () => {
    expect(groupModeAvailability('BATTLE_ROYALE', cr, cr1v1).available).toBe(false);
    expect(groupModeAvailability('DUEL', cr, cr1v1).available).toBe(true);
    expect(groupModeAvailability('DUEL', ff, ffSolo).available).toBe(false);
    expect(groupModeAvailability('DUEL', ff, ffSquad).available).toBe(true);
  });

  it('tipo de partida da fase decide os modelos de pontuação oferecidos', () => {
    expect(stageMatchType('GROUPS', { groupMode: 'BATTLE_ROYALE' }, ffSquad)).toBe('BATTLE_ROYALE');
    expect(stageMatchType('GROUPS', { groupMode: 'DUEL' }, cr1v1)).toBe('DUEL');
    expect(stageMatchType('SINGLE_ELIM', { groupMode: 'DUEL' }, ffSquad)).toBe('TEAM_VS_TEAM');
    expect(compatibleScoringModels(ff, 'BATTLE_ROYALE', null).map((m) => m.id)).toEqual(['sm_ff_padrao', 'sm_ff_liga']);
    expect(compatibleScoringModels(ff, 'TEAM_VS_TEAM', null).map((m) => m.id)).toEqual(['sm_ff_cs']);
  });

  it('modelo personalizado só aparece para quem criou', () => {
    const custom = { ...ff, scoringModels: [...ff.scoringModels, { ...ff.scoringModels[0]!, id: 'sm_meu', isDefault: false, ownerId: 'u_camila' }] };
    expect(compatibleScoringModels(custom, 'BATTLE_ROYALE', 'u_diego').map((m) => m.id)).not.toContain('sm_meu');
    expect(compatibleScoringModels(custom, 'BATTLE_ROYALE', 'u_camila').map((m) => m.id)).toEqual(['sm_ff_padrao', 'sm_ff_liga', 'sm_meu']);
  });

  it('regras de classificação oferecidas por formato', () => {
    expect(qualificationTypesFor('GROUPS')).toEqual(['TOP_N_PER_GROUP', 'TOP_N_OVERALL']);
    expect(qualificationTypesFor('SINGLE_ELIM')).toEqual(['WINNERS']);
    expect(qualificationTypesFor('SWISS')).toEqual(['TOP_N_OVERALL']);
  });
});

describe('fases sugeridas', () => {
  const cases: [string, Game, GameMode, number, StageFormat[]][] = [
    ['FF Squad, 48 vagas', ff, ffSquad, 48, ['GROUPS', 'BATTLE_ROYALE']],
    ['FF Squad, 12 vagas', ff, ffSquad, 12, ['BATTLE_ROYALE']],
    ['FF Squad, 100 vagas', ff, ffSquad, 100, ['GROUPS', 'BATTLE_ROYALE']],
    ['FF Squad, 1.024 vagas', ff, ffSquad, 1024, ['BATTLE_ROYALE', 'BATTLE_ROYALE']],
    ['FF Solo, 48 vagas', ff, ffSolo, 48, ['GROUPS', 'BATTLE_ROYALE']],
    ['CR 1v1, 16 vagas', cr, cr1v1, 16, ['SINGLE_ELIM']],
    ['CR 2v2, 7 vagas', cr, cr2v2, 7, ['SINGLE_ELIM']],
  ];
  it.each(cases)('%s: sugestão válida', (_label, g, m, maxParticipants, formats) => {
    const stages = suggestedStages({ game: g, mode: m, maxParticipants });
    expect(stages.map((s) => s.format)).toEqual(formats);
    expect(validateStages(stages, { maxParticipants, game: g, mode: m })).toEqual([]);
  });

  it('sem jogo ou modo não sugere nada', () => {
    expect(suggestedStages({ game: null, mode: null, maxParticipants: 16 })).toEqual([]);
  });
});

describe('changeStageFormat', () => {
  it('troca a configuração e o modelo, mantendo o nome que a pessoa escreveu', () => {
    const groups = { ...defaultStage('GROUPS', { game: ff, mode: ffSquad }, { isLast: false }), id: 'st_1', name: 'Classificatória' };
    const next = changeStageFormat(groups, 'TEAM_VS_TEAM', { game: ff, mode: ffSquad });
    expect(next).toMatchObject({ id: 'st_1', name: 'Classificatória', format: 'TEAM_VS_TEAM', scoringModelId: 'sm_ff_cs' });
    expect(next.qualification).toEqual({ type: 'WINNERS', n: 2, repechage: 0 });
  });

  it('preserva o que a tela guarda a mais na fase (a chave local)', () => {
    const stage = { ...defaultStage('BATTLE_ROYALE', { game: ff, mode: ffSquad }), key: 'fase-1' };
    expect(changeStageFormat(stage, 'TEAM_VS_TEAM', { game: ff, mode: ffSquad }).key).toBe('fase-1');
  });

  it('nome padrão acompanha o formato e a última fase continua sem classificação', () => {
    const stage = defaultStage('BATTLE_ROYALE', { game: ff, mode: ffSquad });
    const next = changeStageFormat(stage, 'GROUPS', { game: ff, mode: ffSquad });
    expect(next.name).toBe('Fase de grupos');
    expect(next.qualification).toBeNull();
  });
});
