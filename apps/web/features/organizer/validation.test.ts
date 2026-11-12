import { StageConfig, type Game, type GameMode, type Qualification, type StageFormat, type StageInput } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { buildSeed } from '@/mocks/seed';
import { defaultStage } from './lib/formats';
import { computeStageFlow, isRichTextEmpty, validateDraft, validateStages, type DraftForValidation } from './validation';

const games = buildSeed().games;
const game = (id: string): Game => {
  const g = games.find((x) => x.id === id);
  if (!g) throw new Error(`jogo ${id} não está no seed`);
  return g;
};
const modeOf = (g: Game, id: string): GameMode => {
  const m = g.modes.find((x) => x.id === id);
  if (!m) throw new Error(`modo ${id} não está no seed`);
  return m;
};
const ff = game('g_freefire');
const ffSquad = modeOf(ff, 'm_ff_squad');
const ffSolo = modeOf(ff, 'm_ff_solo');
const cr = game('g_clashroyale');
const cr1v1 = modeOf(cr, 'm_cr_1v1');
const ef = game('g_efootball');
const ef1v1 = modeOf(ef, 'm_ef_1v1');

function stage(format: StageFormat, scoringModelId: string, config: Partial<StageConfig>, qualification: Qualification | null, name = 'Fase'): StageInput {
  return { name, format, scoringModelId, config: StageConfig.parse(config), qualification, tiebreakers: ['points', 'draw'], seeding: 'RANDOM' };
}

/** PRD §10.4: 48 squads → 4 grupos BR de 12 (3 quedas) → top 2 → mata-mata 4v4 MD3 → 2 vencedores → final BR de 5 quedas. */
const prdExample: StageInput[] = [
  stage('GROUPS', 'sm_ff_padrao', { groupCount: 4, groupMode: 'BATTLE_ROYALE', drops: 3, lobbySize: 12 }, { type: 'TOP_N_PER_GROUP', n: 2, repechage: 0 }, 'Fase de grupos'),
  stage('TEAM_VS_TEAM', 'sm_ff_cs', { bestOf: 3 }, { type: 'WINNERS', n: 2, repechage: 0 }, 'Mata-mata 4v4'),
  stage('BATTLE_ROYALE', 'sm_ff_padrao', { drops: 5, lobbySize: 12 }, null, 'Grande Final'),
];
const ffCtx = { maxParticipants: 48, game: ff, mode: ffSquad };

describe('computeStageFlow', () => {
  it('segue o exemplo do PRD §10.4: 48 → 8 → 2', () => {
    const flow = computeStageFlow(prdExample, 48);
    expect(flow.map((f) => f.entrants)).toEqual([48, 8, 2]);
    expect(flow.map((f) => f.qualified)).toEqual([8, 2, null]);
    expect(flow[0]).toMatchObject({ pools: 4, poolSize: 12 });
    expect(flow[2]).toMatchObject({ pools: 1 });
  });

  it('soma a repescagem aos classificados', () => {
    const stages = [prdExample[0]!, { ...prdExample[1]!, qualification: { type: 'WINNERS' as const, n: 2, repechage: 4 } }, prdExample[2]!];
    expect(computeStageFlow(stages, 48).map((f) => f.entrants)).toEqual([48, 8, 6]);
  });

  it('fase BR que não é a última divide os participantes em salas', () => {
    const stages = [stage('BATTLE_ROYALE', 'sm_ff_padrao', { lobbySize: 12 }, { type: 'TOP_N_PER_GROUP', n: 3, repechage: 0 }), prdExample[2]!];
    const flow = computeStageFlow(stages, 48);
    expect(flow[0]).toMatchObject({ pools: 4, qualified: 12 });
    expect(flow[1]?.entrants).toBe(12);
  });

  it('não propaga uma conta que não fecha', () => {
    const stages = [stage('SINGLE_ELIM', 'sm_cr_padrao', {}, { type: 'TOP_N_PER_GROUP', n: 2, repechage: 0 }), stage('SINGLE_ELIM', 'sm_cr_padrao', {}, null)];
    expect(computeStageFlow(stages, 16)[1]?.entrants).toBeNull();
  });
});

describe('validateStages — configurações válidas', () => {
  it('aceita o exemplo do PRD §10.4 (grupos BR → mata-mata 4v4 → final BR)', () => {
    expect(validateStages(prdExample, ffCtx)).toEqual([]);
  });

  it('aceita a final BR completada por repescagem até o tamanho da sala', () => {
    const stages = [prdExample[0]!, { ...prdExample[1]!, qualification: { type: 'WINNERS' as const, n: 2, repechage: 6 } }, prdExample[2]!];
    expect(validateStages(stages, ffCtx)).toEqual([]);
  });

  it('aceita grupos de duelos + mata-mata (eFootball, 8 vagas)', () => {
    const stages = [
      stage('GROUPS', 'sm_ef_padrao', { groupCount: 2, groupMode: 'DUEL' }, { type: 'TOP_N_PER_GROUP', n: 2, repechage: 0 }),
      stage('SINGLE_ELIM', 'sm_ef_padrao', { thirdPlace: true }, null),
    ];
    expect(validateStages(stages, { maxParticipants: 8, game: ef, mode: ef1v1 })).toEqual([]);
  });

  it('aceita uma fase única em cada formato de duelo', () => {
    for (const format of ['SINGLE_ELIM', 'DOUBLE_ELIM', 'ROUND_ROBIN', 'SWISS'] as const) {
      expect(validateStages([stage(format, 'sm_cr_padrao', {}, null)], { maxParticipants: 16, game: cr, mode: cr1v1 })).toEqual([]);
    }
  });

  it('aceita quedas em sala única quando as vagas cabem na sala', () => {
    expect(validateStages([stage('BATTLE_ROYALE', 'sm_ff_liga', { drops: 4, lobbySize: 48 }, null)], { maxParticipants: 48, game: ff, mode: ffSolo })).toEqual([]);
  });
});

describe('validateStages — configurações inválidas', () => {
  const messages = (stages: StageInput[], ctx = ffCtx) => validateStages(stages, ctx);

  it('aponta na final quando chegam mais equipes do que cabem na sala', () => {
    const stages = [{ ...prdExample[0]!, qualification: { type: 'TOP_N_PER_GROUP' as const, n: 4, repechage: 0 } }, prdExample[2]!];
    const issues = messages(stages);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ stageIndex: 1, field: 'config' });
    expect(issues[0]?.message).toContain('recebe 16 equipes');
    expect(issues[0]?.message).toContain('comporta 12');
  });

  it('aponta na fase 1 quando as vagas não cabem nos grupos BR', () => {
    const issues = messages(prdExample, { ...ffCtx, maxParticipants: 60 });
    expect(issues[0]).toMatchObject({ stageIndex: 0, field: 'config' });
    expect(issues[0]?.message).toContain('60 vagas do campeonato');
    expect(issues[0]?.message).toContain('pelo menos 5 grupos');
  });

  it('não aceita mais grupos do que participantes', () => {
    const stages = [stage('GROUPS', 'sm_ef_padrao', { groupCount: 6, groupMode: 'DUEL' }, null)];
    const issues = validateStages(stages, { maxParticipants: 4, game: ef, mode: ef1v1 });
    expect(issues).toEqual([{ stageIndex: 0, field: 'config', message: 'Há mais grupos (6) do que participantes (4). Use no máximo 2 grupos.' }]);
  });

  it('não aceita grupo que ficaria com menos de 2', () => {
    const stages = [stage('GROUPS', 'sm_ef_padrao', { groupCount: 5, groupMode: 'DUEL' }, null)];
    const issues = validateStages(stages, { maxParticipants: 8, game: ef, mode: ef1v1 });
    expect(issues[0]?.message).toContain('algum grupo ficaria com menos de 2');
  });

  it('eliminação precisa de pelo menos 2 participantes', () => {
    const stages = [
      stage('GROUPS', 'sm_ef_padrao', { groupCount: 1, groupMode: 'DUEL' }, { type: 'TOP_N_OVERALL', n: 1, repechage: 0 }),
      stage('SINGLE_ELIM', 'sm_ef_padrao', {}, null),
    ];
    const issues = validateStages(stages, { maxParticipants: 8, game: ef, mode: ef1v1 });
    expect(issues.map((i) => [i.stageIndex, i.field])).toEqual([
      [0, 'qualification'],
      [1, 'config'],
    ]);
    expect(issues[1]?.message).toBe('Eliminação simples precisa de pelo menos 2 participantes, mas esta fase recebe 1.');
  });

  it('top N por grupo maior que o grupo não fecha', () => {
    const stages = [{ ...prdExample[0]!, qualification: { type: 'TOP_N_PER_GROUP' as const, n: 13, repechage: 0 } }, prdExample[2]!];
    expect(messages(stages)[0]).toMatchObject({ stageIndex: 0, field: 'qualification' });
  });

  it('vencedores do mata-mata precisam ser potência de 2 e menores que a chave', () => {
    const with3 = [prdExample[0]!, { ...prdExample[1]!, qualification: { type: 'WINNERS' as const, n: 3, repechage: 0 } }, prdExample[2]!];
    expect(messages(with3)[0]?.message).toContain('1, 2, 4, 8');
    const with8 = [prdExample[0]!, { ...prdExample[1]!, qualification: { type: 'WINNERS' as const, n: 8, repechage: 0 } }, prdExample[2]!];
    expect(messages(with8)[0]?.message).toContain('ninguém seria eliminado');
  });

  it('repescagem não pode pedir mais gente do que a fase tem', () => {
    const stages = [prdExample[0]!, { ...prdExample[1]!, qualification: { type: 'WINNERS' as const, n: 4, repechage: 6 } }, prdExample[2]!];
    expect(messages(stages)[0]).toMatchObject({ stageIndex: 1, field: 'qualification' });
  });

  it('fase que não é a última precisa de regra de classificação; a última não pode ter', () => {
    const missing = [{ ...prdExample[0]!, qualification: null }, prdExample[2]!];
    expect(messages(missing)[0]).toMatchObject({ stageIndex: 0, field: 'qualification', message: 'Defina quem avança para a próxima fase.' });
    const extra = [{ ...prdExample[2]!, qualification: { type: 'TOP_N_OVERALL' as const, n: 2, repechage: 0 } }];
    expect(validateStages(extra, { ...ffCtx, maxParticipants: 12 })[0]).toMatchObject({ stageIndex: 0, field: 'qualification' });
  });

  it('regra de classificação que não combina com o formato', () => {
    const perGroupInBracket = [stage('SINGLE_ELIM', 'sm_cr_padrao', {}, { type: 'TOP_N_PER_GROUP', n: 2, repechage: 0 }), stage('SINGLE_ELIM', 'sm_cr_padrao', {}, null)];
    expect(validateStages(perGroupInBracket, { maxParticipants: 16, game: cr, mode: cr1v1 })[0]?.message).toContain('"Vencedores"');
    const winnersInLeague = [stage('ROUND_ROBIN', 'sm_cr_padrao', {}, { type: 'WINNERS', n: 2, repechage: 0 }), stage('SINGLE_ELIM', 'sm_cr_padrao', {}, null)];
    expect(validateStages(winnersInLeague, { maxParticipants: 16, game: cr, mode: cr1v1 })[0]?.message).toContain('"Top N geral"');
  });

  it('formato incompatível com o modo do jogo', () => {
    const brInDuel = validateStages([stage('BATTLE_ROYALE', 'sm_cr_padrao', {}, null)], { maxParticipants: 8, game: cr, mode: cr1v1 });
    expect(brInDuel.some((i) => i.field === 'format' && i.message.includes('Battle Royale só serve'))).toBe(true);
    const duelInSolo = validateStages([stage('SINGLE_ELIM', 'sm_ff_cs', {}, null)], { maxParticipants: 8, game: ff, mode: ffSolo });
    expect(duelInSolo.some((i) => i.field === 'format')).toBe(true);
  });

  it('modelo de pontuação ausente, de outro jogo ou de outro tipo de partida', () => {
    expect(messages([{ ...prdExample[2]!, scoringModelId: '' }], { ...ffCtx, maxParticipants: 12 })[0]).toMatchObject({ field: 'scoring' });
    expect(messages([{ ...prdExample[2]!, scoringModelId: 'sm_cr_padrao' }], { ...ffCtx, maxParticipants: 12 })[0]?.message).toContain('não existe em Free Fire');
    expect(messages([{ ...prdExample[2]!, scoringModelId: 'sm_ff_cs' }], { ...ffCtx, maxParticipants: 12 })[0]?.message).toContain('Escolha um modelo compatível');
  });

  it('sala maior que o limite do modo', () => {
    const issues = messages([stage('BATTLE_ROYALE', 'sm_ff_padrao', { lobbySize: 20 }, null)], { ...ffCtx, maxParticipants: 12 });
    expect(issues[0]?.message).toContain('no máximo 12 equipes');
  });

  it('suíço com rodadas demais para o número de participantes', () => {
    const issues = validateStages([stage('SWISS', 'sm_cr_padrao', { rounds: 9 }, null)], { maxParticipants: 8, game: cr, mode: cr1v1 });
    expect(issues[0]?.message).toContain('no máximo 7 rodadas');
  });

  it('nome em branco e desempate vazio ou repetido', () => {
    const blank = validateStages([{ ...stage('SINGLE_ELIM', 'sm_cr_padrao', {}, null), name: '  ' }], { maxParticipants: 8, game: cr, mode: cr1v1 });
    expect(blank[0]).toMatchObject({ field: 'name' });
    const none = validateStages([{ ...stage('SINGLE_ELIM', 'sm_cr_padrao', {}, null), tiebreakers: [] }], { maxParticipants: 8, game: cr, mode: cr1v1 });
    expect(none[0]).toMatchObject({ field: 'tiebreakers' });
    const twice = validateStages([{ ...stage('SINGLE_ELIM', 'sm_cr_padrao', {}, null), tiebreakers: ['points', 'points'] }], { maxParticipants: 8, game: cr, mode: cr1v1 });
    expect(twice[0]?.message).toContain('repetido');
  });
});

describe('validateDraft', () => {
  const now = new Date('2026-11-12T12:00:00.000Z');
  const valid: DraftForValidation = {
    name: 'Copa de Teste',
    description: '',
    rules: '<p>Regras</p>',
    prize: '',
    streamUrls: ['https://www.twitch.tv/novaarena'],
    gameId: ff.id,
    gameModeId: ffSquad.id,
    maxParticipants: 48,
    registrationOpensAt: null,
    registrationClosesAt: '2026-11-18T23:00:00.000Z',
    startsAt: '2026-11-19T23:00:00.000Z',
    rosterLockAt: null,
    checkIn: { enabled: true, opensMinutesBefore: 30, closesMinutesBefore: 10, requireAllMembers: false },
    stages: prdExample,
  };
  const check = (patch: Partial<DraftForValidation>, ctx: Partial<Parameters<typeof validateDraft>[1]> = {}) => validateDraft({ ...valid, ...patch }, { games, now, ...ctx });

  it('rascunho completo não tem pendências', () => {
    expect(check({})).toEqual([]);
  });

  it('liga cada pendência ao passo certo', () => {
    const issues = check({ name: 'ab', gameModeId: 'm_inexistente', startsAt: null, stages: [], rules: '<p></p>' });
    expect(issues.map((i) => [i.step, i.field])).toEqual([
      [0, 'name'],
      [1, 'gameModeId'],
      [2, 'startsAt'],
      [3, 'stages'],
      [5, 'rules'],
    ]);
  });

  it('pendência de fase vai para o passo Fases e a de pontuação para o passo Pontuação, com o nome da fase', () => {
    const stages = [{ ...prdExample[0]!, qualification: { type: 'TOP_N_PER_GROUP' as const, n: 4, repechage: 0 } }, { ...prdExample[2]!, scoringModelId: '' }];
    const issues = check({ stages });
    expect(issues).toEqual([
      expect.objectContaining({ step: 3, field: 'stages.1.config', stageIndex: 1, message: expect.stringContaining('Grande Final: ') }),
      expect.objectContaining({ step: 4, field: 'stages.1.scoring', stageIndex: 1 }),
    ]);
  });

  it('datas: passado, ordem e trava de elenco', () => {
    expect(check({ startsAt: '2026-11-01T00:00:00.000Z' }).map((i) => i.field)).toContain('startsAt');
    expect(check({ registrationClosesAt: '2026-11-20T00:00:00.000Z' })[0]?.message).toContain('antes do início');
    expect(check({ registrationOpensAt: '2026-11-19T00:00:00.000Z' })[0]).toMatchObject({ field: 'registrationOpensAt' });
    expect(check({ rosterLockAt: '2026-11-25T00:00:00.000Z' })[0]).toMatchObject({ field: 'rosterLockAt' });
  });

  it('campeonato já publicado não reclama de data passada, mas respeita as vagas ocupadas', () => {
    const past = { startsAt: '2026-11-02T00:00:00.000Z', registrationClosesAt: '2026-11-01T00:00:00.000Z' };
    expect(check(past, { alreadyPublished: true })).toEqual([]);
    expect(check({ maxParticipants: 8, stages: [prdExample[2]!] }, { alreadyPublished: true, takenSlots: 10 })[0]?.message).toContain('10 vagas ocupadas');
  });

  it('links de transmissão só da Twitch e do YouTube', () => {
    expect(check({ streamUrls: ['https://exemplo.com/live'] })[0]).toMatchObject({ step: 0, field: 'streamUrls.0' });
  });

  it('jogo desativado e janela de check-in invertida', () => {
    const inactive = games.map((g) => (g.id === ff.id ? { ...g, active: false } : g));
    expect(check({}, { games: inactive })[0]).toMatchObject({ step: 1, field: 'gameId' });
    expect(check({ checkIn: { enabled: true, opensMinutesBefore: 10, closesMinutesBefore: 10, requireAllMembers: false } })[0]).toMatchObject({ field: 'checkIn.closesMinutesBefore' });
  });

  it('fase padrão de cada formato disponível é válida no próprio modo', () => {
    const duel = defaultStage('SINGLE_ELIM', { game: cr, mode: cr1v1 }, { isLast: true });
    expect(check({ gameId: cr.id, gameModeId: cr1v1.id, maxParticipants: 16, stages: [duel] })).toEqual([]);
  });
});

describe('isRichTextEmpty', () => {
  it('trata parágrafo vazio como vazio', () => {
    expect(isRichTextEmpty('')).toBe(true);
    expect(isRichTextEmpty('<p></p>')).toBe(true);
    expect(isRichTextEmpty('<p>&nbsp; </p><p><br></p>')).toBe(true);
    expect(isRichTextEmpty('<p>Regra 1</p>')).toBe(false);
  });
});
