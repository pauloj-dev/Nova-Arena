import type { Stage } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { defaultStage } from './CompetitionTabs';
import { parseTab } from './TournamentPage';

const stage = (order: number, status: Stage['status']) => ({ id: `s${order}`, order, status }) as Stage;

describe('abas de competição da página do campeonato', () => {
  it('parseTab: as abas de competição só valem quando o campeonato já tem chave confirmada', () => {
    expect(parseTab('chave', true)).toBe('chave');
    expect(parseTab('partidas', true)).toBe('partidas');
    expect(parseTab('resultados', true)).toBe('resultados');
    expect(parseTab('chave', false)).toBe('visao-geral');
    expect(parseTab('partidas', false)).toBe('visao-geral');
    // As abas da F1 não dependem disso.
    expect(parseTab('inscritos', false)).toBe('inscritos');
    expect(parseTab('comunicados', true)).toBe('comunicados');
  });

  it('parseTab: `?aba=tabela` (links de notificação) abre Chave/Tabela; valor desconhecido cai na visão geral', () => {
    expect(parseTab('tabela', true)).toBe('chave');
    expect(parseTab('tabela', false)).toBe('visao-geral');
    expect(parseTab('qualquer-coisa', true)).toBe('visao-geral');
    expect(parseTab(null, true)).toBe('visao-geral');
  });

  it('defaultStage: abre na fase em andamento; senão na última já jogada; senão na primeira', () => {
    expect(defaultStage([stage(1, 'COMPLETED'), stage(2, 'ACTIVE'), stage(3, 'PENDING')])?.id).toBe('s2');
    expect(defaultStage([stage(3, 'PENDING'), stage(2, 'COMPLETED'), stage(1, 'COMPLETED')])?.id).toBe('s2');
    expect(defaultStage([stage(2, 'PENDING'), stage(1, 'PENDING')])?.id).toBe('s1');
    expect(defaultStage([])).toBeUndefined();
  });
});
