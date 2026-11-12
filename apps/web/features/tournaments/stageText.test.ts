import { StageConfig, type Stage } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { bestOfText, describeAdvancement, describeStageFormat, STAGE_FORMAT_LABELS } from './stageText';

function stage(format: Stage['format'], config: Partial<Stage['config']> = {}): Pick<Stage, 'format' | 'config'> {
  return { format, config: StageConfig.parse(config) };
}

describe('bestOfText', () => {
  it('MD1 é "jogo único"; os demais dizem o número', () => {
    expect(bestOfText(1)).toBe('jogo único');
    expect(bestOfText(3)).toBe('melhor de 3 (MD3)');
    expect(bestOfText(5)).toBe('melhor de 5 (MD5)');
  });
});

describe('describeStageFormat', () => {
  it('todo formato tem rótulo e pelo menos uma frase', () => {
    for (const format of Object.keys(STAGE_FORMAT_LABELS) as Stage['format'][]) {
      expect(STAGE_FORMAT_LABELS[format]).not.toBe('');
      expect(describeStageFormat(stage(format)).length).toBeGreaterThan(0);
    }
  });

  it('grupos em Battle Royale: grupos, quedas e tamanho da sala', () => {
    expect(describeStageFormat(stage('GROUPS', { groupCount: 4, groupMode: 'BATTLE_ROYALE', drops: 3, lobbySize: 12 }))).toEqual([
      '4 grupos.',
      'Cada grupo joga 3 quedas de Battle Royale, com até 12 equipes por sala.',
      'Os pontos de todas as quedas se somam.',
    ]);
  });

  it('grupos em duelos: ida e volta e tamanho da série', () => {
    expect(describeStageFormat(stage('GROUPS', { groupCount: 2, groupMode: 'DUEL', doubleRound: true, bestOf: 3 }))).toEqual([
      '2 grupos.',
      'Dentro do grupo, todos se enfrentam duas vezes (ida e volta).',
      'Cada confronto é em melhor de 3 (MD3).',
    ]);
    expect(describeStageFormat(stage('GROUPS', { groupCount: 1, groupMode: 'DUEL' }))[0]).toBe('1 grupo.');
  });

  it('mata-mata: série e disputa de 3º lugar só quando existe', () => {
    expect(describeStageFormat(stage('SINGLE_ELIM', { bestOf: 3, thirdPlace: true }))).toEqual(['Mata-mata: quem perde está fora.', 'Cada confronto é em melhor de 3 (MD3).', 'Tem disputa de 3º lugar.']);
    expect(describeStageFormat(stage('SINGLE_ELIM', { bestOf: 1 }))).toEqual(['Mata-mata: quem perde está fora.', 'Cada confronto é em jogo único.']);
  });

  it('eliminação dupla explica a final extra', () => {
    const withReset = describeStageFormat(stage('DOUBLE_ELIM', { bestOf: 3, grandFinalReset: true }));
    expect(withReset[0]).toBe('Eliminação dupla: só sai quem perder duas vezes.');
    expect(withReset).toHaveLength(3);
    expect(describeStageFormat(stage('DOUBLE_ELIM', { grandFinalReset: false }))).toHaveLength(2);
  });

  it('Battle Royale: singular, sala de jogadores no solo e multiplicador da última queda', () => {
    expect(describeStageFormat(stage('BATTLE_ROYALE', { drops: 1, lobbySize: 48 }), 'SOLO')).toEqual(['1 queda de Battle Royale, com até 48 jogadores por sala.', 'Os pontos de todas as quedas se somam.']);
    expect(describeStageFormat(stage('BATTLE_ROYALE', { drops: 5, lobbySize: 12, lastDropMultiplier: 2 }))).toContain('A última queda vale ×2.');
    expect(describeStageFormat(stage('BATTLE_ROYALE', { lastDropMultiplier: 1.5 }))).toContain('A última queda vale ×1,5.');
  });

  it('suíço diz o número de rodadas e que ninguém sai antes do fim', () => {
    const text = describeStageFormat(stage('SWISS', { rounds: 3, bestOf: 3 }));
    expect(text[0]).toContain('3 rodadas');
    expect(text).toContain('Ninguém é eliminado antes da última rodada.');
  });

  it('pontos corridos: turno único ou ida e volta', () => {
    expect(describeStageFormat(stage('ROUND_ROBIN'))[0]).toBe('Pontos corridos: todos se enfrentam uma vez.');
    expect(describeStageFormat(stage('ROUND_ROBIN', { doubleRound: true }))[0]).toBe('Pontos corridos: todos se enfrentam duas vezes (ida e volta).');
  });
});

describe('describeAdvancement', () => {
  it('última fase define o campeão', () => {
    expect(describeAdvancement(null)).toBe('Última fase: daqui sai o campeão.');
  });

  it('melhores de cada grupo, em equipes e no solo', () => {
    expect(describeAdvancement({ type: 'TOP_N_PER_GROUP', n: 2, repechage: 0 })).toBe('Avançam as 2 melhores equipes de cada grupo.');
    expect(describeAdvancement({ type: 'TOP_N_PER_GROUP', n: 2, repechage: 0 }, 'SOLO')).toBe('Avançam os 2 melhores jogadores de cada grupo.');
    expect(describeAdvancement({ type: 'TOP_N_PER_GROUP', n: 1, repechage: 0 })).toBe('Avança a melhor equipe de cada grupo.');
  });

  it('melhores da classificação geral e vencedores da chave', () => {
    expect(describeAdvancement({ type: 'TOP_N_OVERALL', n: 12, repechage: 0 })).toBe('Avançam as 12 melhores equipes da classificação geral.');
    expect(describeAdvancement({ type: 'WINNERS', n: 2, repechage: 0 })).toBe('Avançam as 2 equipes que chegarem mais longe na chave.');
    expect(describeAdvancement({ type: 'WINNERS', n: 1, repechage: 0 }, 'SOLO')).toBe('Avança quem vencer a chave.');
  });

  it('repescagem aparece só quando está ligada', () => {
    expect(describeAdvancement({ type: 'TOP_N_PER_GROUP', n: 2, repechage: 4 })).toBe('Avançam as 2 melhores equipes de cada grupo. Os 4 melhores eliminados completam a próxima fase.');
    expect(describeAdvancement({ type: 'TOP_N_OVERALL', n: 3, repechage: 1 }, 'SOLO')).toBe('Avançam os 3 melhores jogadores da classificação geral. O melhor eliminado completa a próxima fase.');
  });
});
