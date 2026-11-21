import { describe, expect, it } from 'vitest';
import { candidateScore, linesFromText, normalize, parseBrDrop, parseDuel, similarity, type OcrCandidate } from './parse';

const squads: OcrCandidate[] = [
  { registrationId: 'r1', name: 'Alfa Squad', tag: 'ALF' },
  { registrationId: 'r2', name: 'Bravo Équipe', tag: 'BRV' },
  { registrationId: 'r3', name: 'Charlie Team', tag: 'CHL' },
  { registrationId: 'r4', name: 'Delta Força', tag: 'DLT' },
];

const read = (text: string, confidence = 90) => ({ text, lines: linesFromText(text, confidence) });

describe('normalização e semelhança', () => {
  it('ignora acento, caixa e pontuação', () => {
    expect(normalize('  Bravo Équipe!! ')).toBe('bravo equipe');
    expect(similarity('BRAVO EQUIPE', 'Bravo Équipe')).toBe(1);
  });

  it('tolera erro pequeno de leitura e reconhece a tag', () => {
    expect(similarity('Charlle Tearn', 'Charlie Team')).toBeGreaterThan(0.7);
    expect(candidateScore('[DLT] Força', squads[3] as OcrCandidate)).toBeGreaterThanOrEqual(0.95);
    expect(candidateScore('Zulu', squads[0] as OcrCandidate)).toBeLessThan(0.6);
  });
});

describe('queda de Battle Royale', () => {
  it('lê colocação e kills de cada equipe, em qualquer ordem de linhas', () => {
    const { suggestions, unmatched } = parseBrDrop(
      read(['RESULTADO DA QUEDA', '#1 Charlie Team 12 kills', '#2 Alfa Squad 7 kills', '#3 Delta Força 3 kills', '#4 Bravo Equipe 0 kills'].join('\n')),
      squads,
    );
    expect(unmatched).toEqual([]);
    const by = Object.fromEntries(suggestions.map((s) => [s.registrationId, s]));
    expect(by.r3).toMatchObject({ placement: 1, kills: 12, placementInferred: false });
    expect(by.r1).toMatchObject({ placement: 2, kills: 7 });
    expect(by.r4).toMatchObject({ placement: 3, kills: 3 });
    expect(by.r2).toMatchObject({ placement: 4, kills: 0 });
    expect(by.r3?.source).toBe('#1 Charlie Team 12 kills');
  });

  it('corrige confusões comuns de dígito (O → 0, l → 1) e aceita ordinal', () => {
    const { suggestions } = parseBrDrop(read('1º Alfa Squad 1O\n2º Bravo Equipe 1l'), squads);
    expect(suggestions.find((s) => s.registrationId === 'r1')).toMatchObject({ placement: 1, kills: 10 });
    expect(suggestions.find((s) => s.registrationId === 'r2')).toMatchObject({ placement: 2, kills: 11 });
  });

  it('acha a equipe pela tag', () => {
    const { suggestions } = parseBrDrop(read('1 [CHL] 9\n2 [ALF] 4'), squads);
    expect(suggestions.map((s) => [s.registrationId, s.placement, s.kills])).toEqual([
      ['r1', 2, 4],
      ['r3', 1, 9],
    ]);
  });

  it('sem número de colocação, usa a ordem das linhas e marca como inferida (com confiança menor)', () => {
    const { suggestions } = parseBrDrop(read('Delta Força 5\nAlfa Squad 2'), squads);
    expect(suggestions.find((s) => s.registrationId === 'r4')).toMatchObject({ placement: 1, kills: 5, placementInferred: true });
    expect(suggestions.find((s) => s.registrationId === 'r1')).toMatchObject({ placement: 2, kills: 2, placementInferred: true });
    expect(suggestions[0]?.confidence).toBeLessThan(0.9 * 0.81);
  });

  it('descarta colocação fora da sala e não usa a mesma linha para duas equipes', () => {
    const { suggestions, unmatched } = parseBrDrop(read('9 Alfa Squad 3\nZulu Clan 2 4'), squads);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ registrationId: 'r1', placement: null, kills: 3 });
    expect(unmatched).toEqual(['Zulu Clan 2 4']);
  });

  it('colocação que o OCR não leu sai das linhas vizinhas (caso real: "#1" lido como "al")', () => {
    const { suggestions } = parseBrDrop(read('RESULTADO DA QUEDA\nal Charlie Team 12 kills\n#2 Alfa Squad 7 kills\n#3 Delta Força 3 kills'), squads);
    expect(suggestions.find((s) => s.registrationId === 'r3')).toMatchObject({ placement: 1, kills: 12, placementInferred: true });
    expect(suggestions.find((s) => s.registrationId === 'r1')).toMatchObject({ placement: 2, placementInferred: false });
  });

  it('palavra comum a todas as equipes ("Squad") não faz uma equipe parecer outra', () => {
    const room: OcrCandidate[] = [
      { registrationId: 'f', name: 'Squad Falcão', tag: null },
      { registrationId: 'l', name: 'Squad Lobo', tag: null },
    ];
    const { suggestions, unmatched } = parseBrDrop(read('#2 Squad Alfa 7 kills\n#1 Squad Lobo 4 kills'), room);
    expect(suggestions.map((s) => s.registrationId)).toEqual(['l']);
    expect(unmatched).toEqual(['#2 Squad Alfa 7 kills']);
  });

  it('usa a confiança do OCR em cada linha', () => {
    const { suggestions } = parseBrDrop({ text: '', lines: [{ text: '1 Alfa Squad 3', confidence: 40 }] }, squads);
    expect(suggestions[0]?.confidence).toBeCloseTo(0.4, 2);
  });
});

describe('duelo', () => {
  const sides: [OcrCandidate, OcrCandidate] = [
    { registrationId: 'a', name: 'BiancaGG', tag: null },
    { registrationId: 'b', name: 'LucasPro', tag: null },
  ];

  it('lê "3 x 1" e liga cada número ao nome na ordem do print', () => {
    expect(parseDuel(read('VITÓRIA\nBiancaGG 3 x 1 LucasPro'), sides).map((s) => s.score)).toEqual([3, 1]);
    // Print com os lados trocados: o 1º número é de quem aparece primeiro.
    expect(parseDuel(read('LucasPro\n2 - 0\nBiancaGG'), sides).map((s) => s.score)).toEqual([0, 2]);
  });

  it('sem "x", usa o número da linha de cada nome', () => {
    expect(parseDuel(read('BiancaGG 2\nLucasPro 1'), sides, 3).map((s) => s.score)).toEqual([2, 1]);
  });

  it('em série melhor de 3, placar acima de 2 é descartado', () => {
    expect(parseDuel(read('BiancaGG 5 x 1 LucasPro'), sides, 3).map((s) => s.score)).toEqual([null, 1]);
  });

  it('nada reconhecível: sem sugestão', () => {
    expect(parseDuel(read('carregando...'), sides).every((s) => s.score === null && s.source === null)).toBe(true);
  });
});
