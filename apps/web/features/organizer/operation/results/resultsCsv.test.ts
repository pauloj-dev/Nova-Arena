import { describe, expect, it } from 'vitest';
import { chunk, importableResults, parseResultsCsv, resultsCsvTemplate } from './resultsCsv';
import { duelMatch, lobbyMatch } from './testing';

const squads = ['Squad Alfa', 'Squad Bravo', 'Squad Charlie'];
const g1q1 = lobbyMatch(squads, { id: 'f~a1', groupId: 'a', groupName: 'Grupo A', dropIndex: 1, round: 1, roundLabel: 'Queda 1' });
const g1q2 = lobbyMatch(squads, { id: 'f~a2', groupId: 'a', groupName: 'Grupo A', dropIndex: 2, round: 2, roundLabel: 'Queda 2' });
const g2q1 = lobbyMatch(['Squad Delta', 'Squad Eco'], { id: 'f~b1', groupId: 'b', groupName: 'Grupo B', dropIndex: 1, round: 1, roundLabel: 'Queda 1' });
const matches = [g1q1, g1q2, g2q1];

const csv = (...lines: string[]) => ['grupo;queda;squad;colocacao;kills', ...lines].join('\r\n');

describe('modelo de CSV da fase', () => {
  it('traz uma linha por squad e queda, com colocação e kills em branco', () => {
    const template = resultsCsvTemplate(matches);
    const lines = template.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('grupo;queda;squad;colocacao;kills');
    expect(lines).toHaveLength(1 + 3 + 3 + 2);
    expect(lines[1]).toBe('Grupo A;1;Squad Alfa;;');
    expect(lines.at(-1)).toBe('Grupo B;1;Squad Eco;;');
  });

  it('não lista quedas que já têm resultado, e o próprio modelo em branco não gera erro', () => {
    const template = resultsCsvTemplate([{ ...g1q1, status: 'VALIDATED' }, g1q2, duelMatch('A', 'B')]);
    expect(template).not.toContain('Grupo A;1;');
    expect(parseResultsCsv(template, matches).fatal).toMatch(/nenhuma linha com colocação e kills/);
  });
});

describe('prévia da importação', () => {
  it('lê um arquivo certo e monta as quedas no formato da API', () => {
    const parsed = parseResultsCsv(csv('Grupo A;1;Squad Alfa;1;7', 'Grupo A;1;Squad Bravo;2;9', 'grupo a;1;squad charlie;3;4', 'Grupo B;1;Squad Delta;ausente;', 'Grupo B;1;Squad Eco;1;3', 'Grupo A;2;Squad Alfa;;'), matches);
    expect(parsed.fatal).toBeNull();
    expect(parsed.lines.every((l) => l.errors.length === 0)).toBe(true);
    expect(importableResults(parsed)).toEqual([
      { matchId: 'f~a1', entries: [{ registrationId: 'r1', placement: 1, kills: 7 }, { registrationId: 'r2', placement: 2, kills: 9 }, { registrationId: 'r3', placement: 3, kills: 4 }] },
      { matchId: 'f~b1', entries: [{ registrationId: 'r1', absent: true }, { registrationId: 'r2', placement: 1, kills: 3 }] },
    ]);
  });

  it('aponta, por linha, squad desconhecido, colocação repetida na mesma queda e número inválido', () => {
    const parsed = parseResultsCsv(
      csv(
        'Grupo A;1;Squad Alfa;1;7', // linha 2: repetida com a 3
        'Grupo A;1;Squad Bravo;1;9', // linha 3
        'Grupo A;1;Squad Zebra;3;4', // linha 4: squad desconhecido
        'Grupo A;2;Squad Alfa;abc;2', // linha 5: colocação inválida
        'Grupo A;2;Squad Bravo;2;-3', // linha 6: kills negativas
        'Grupo C;1;Squad Alfa;1;1', // linha 7: grupo inexistente
        'Grupo A;9;Squad Alfa;1;1', // linha 8: queda inexistente
        'Grupo B;1;Squad Delta;1;2', // linha 9: certa
        'Grupo B;1;Squad Eco;2;0', // linha 10: certa
      ),
      matches,
    );
    const errorsOf = (line: number) => parsed.lines.find((l) => l.line === line)?.errors.join(' ') ?? '';
    expect(errorsOf(2)).toMatch(/Colocação 1 repetida nesta queda \(também na linha 3\)/);
    expect(errorsOf(3)).toMatch(/Colocação 1 repetida/);
    expect(errorsOf(4)).toMatch(/Squad "Squad Zebra" não está nesta sala/);
    expect(errorsOf(5)).toMatch(/Colocação "abc" não é um número/);
    expect(errorsOf(6)).toMatch(/Kills não podem ser negativas/);
    expect(errorsOf(7)).toMatch(/Grupo ou sala "Grupo C" não existe/);
    expect(errorsOf(8)).toMatch(/A queda 9 não existe em Grupo A/);
    expect(errorsOf(9)).toBe('');

    // Só a queda sem nenhum erro vai para o envio.
    expect(importableResults(parsed).map((m) => m.matchId)).toEqual(['f~b1']);
    expect(parsed.matches.find((m) => m.matchId === 'f~a1')?.ready).toBe(false);
  });

  it('queda incompleta ou já lançada fica de fora, com o motivo', () => {
    const incomplete = parseResultsCsv(csv('Grupo A;1;Squad Alfa;1;7', 'Grupo A;1;Squad Bravo;2;9'), matches);
    expect(incomplete.matches[0]?.errors[0]).toMatch(/Falta 1 squad nesta queda: Squad Charlie/);
    expect(importableResults(incomplete)).toEqual([]);

    const played = parseResultsCsv(csv('Grupo B;1;Squad Delta;1;2', 'Grupo B;1;Squad Eco;2;0'), [g1q1, { ...g2q1, status: 'VALIDATED' }]);
    expect(played.matches[0]?.errors[0]).toMatch(/já tem resultado/);
    expect(importableResults(played)).toEqual([]);
  });

  it('aceita vírgula como separador, cabeçalho com acento e sala única sem a coluna de grupo', () => {
    const single = [lobbyMatch(squads, { id: 'f~s1', groupName: 'Sala 1' })];
    const parsed = parseResultsCsv('Queda,Equipe,Colocação,Kills\n1,Squad Alfa,2,1\n1,Squad Bravo,1,5\n1,Squad Charlie,3,0\n', single);
    expect(parsed.fatal).toBeNull();
    expect(importableResults(parsed)).toHaveLength(1);
  });

  it('arquivo vazio, sem as colunas ou fase sem quedas: erro que impede a leitura', () => {
    expect(parseResultsCsv('', matches).fatal).toBe('O arquivo está vazio.');
    expect(parseResultsCsv('coluna;pontos\nAlfa;3', matches).fatal).toMatch(/Não encontramos as colunas "queda", "squad", "colocacao", "kills"/);
    expect(parseResultsCsv(csv('Grupo A;1;Squad Alfa;1;1'), [duelMatch('A', 'B')]).fatal).toMatch(/não tem quedas/);
  });

  it('divide o envio em lotes de até 50 partidas', () => {
    const items = Array.from({ length: 120 }, (_, i) => i);
    expect(chunk(items).map((c) => c.length)).toEqual([50, 50, 20]);
    expect(chunk([], 50)).toEqual([]);
  });
});
