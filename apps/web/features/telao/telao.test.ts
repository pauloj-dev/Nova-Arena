import type { Stage } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { buildStage, standingRow } from '@/features/brackets/test/fixtures';
import { bracketPages, DEFAULT_INTERVAL_SECONDS, nextIndex, parseTelaoOptions, pickStage, previousIndex, standingsPages, telaoHref } from './telao';

const params = (qs: string) => new URLSearchParams(qs);

describe('parseTelaoOptions', () => {
  it('padrões: fase atual, fundo normal, 12 s e tema escuro', () => {
    expect(parseTelaoOptions(params(''))).toEqual({ stageId: null, transparent: false, intervalMs: DEFAULT_INTERVAL_SECONDS * 1000, theme: 'escuro' });
  });

  it('lê fase, fundo transparente, intervalo e tema claro', () => {
    expect(parseTelaoOptions(params('fase=st_2&fundo=transparente&intervalo=20&tema=claro'))).toEqual({ stageId: 'st_2', transparent: true, intervalMs: 20_000, theme: 'claro' });
  });

  it('limita o intervalo entre 5 s e 120 s e ignora valor inválido', () => {
    expect(parseTelaoOptions(params('intervalo=1')).intervalMs).toBe(5_000);
    expect(parseTelaoOptions(params('intervalo=999')).intervalMs).toBe(120_000);
    expect(parseTelaoOptions(params('intervalo=abc')).intervalMs).toBe(DEFAULT_INTERVAL_SECONDS * 1000);
    expect(parseTelaoOptions(params('fundo=azul')).transparent).toBe(false);
  });
});

describe('rotação', () => {
  it('avança e volta em círculo; com uma página fica parada', () => {
    expect(nextIndex(0, 3)).toBe(1);
    expect(nextIndex(2, 3)).toBe(0);
    expect(previousIndex(0, 3)).toBe(2);
    expect(nextIndex(0, 1)).toBe(0);
    expect(previousIndex(0, 0)).toBe(0);
  });
});

describe('pickStage e telaoHref', () => {
  const stage = (id: string, order: number, status: Stage['status']) => ({ id, order, status }) as Stage;
  const stages = [stage('final', 2, 'PENDING'), stage('grupos', 1, 'COMPLETED')];

  it('sem fase pedida, mostra a primeira não concluída; com fase inexistente, também', () => {
    expect(pickStage(stages, null)?.id).toBe('final');
    expect(pickStage(stages, 'nao-existe')?.id).toBe('final');
    expect(pickStage(stages, 'grupos')?.id).toBe('grupos');
    expect(pickStage([stage('a', 1, 'COMPLETED')], null)?.id).toBe('a');
    expect(pickStage([], null)).toBeUndefined();
  });

  it('monta o link com fase e fundo transparente', () => {
    expect(telaoHref('copa', 'tabela')).toBe('/c/copa/telao/tabela');
    expect(telaoHref('copa', 'chave', { stageId: 'st_1', transparent: true })).toBe('/c/copa/telao/chave?fase=st_1&fundo=transparente');
  });
});

describe('standingsPages', () => {
  it('uma página por grupo, com o nome do grupo', () => {
    const pages = standingsPages({
      groups: [
        { groupId: 'g1', name: 'Grupo A', rows: [standingRow(1), standingRow(2)] },
        { groupId: 'g2', name: 'Grupo B', rows: [standingRow(1, { registrationId: 'x' })] },
        { groupId: 'g3', name: 'Grupo C', rows: [] },
      ],
      overall: [],
    });
    expect(pages.map((p) => p.label)).toEqual(['Grupo A', 'Grupo B']);
    expect(pages.map((p) => p.key)).toEqual(['g1-0', 'g2-0']);
  });

  it('sem grupos usa a tabela geral e quebra tabela longa em partes', () => {
    const rows = Array.from({ length: 23 }, (_, i) => standingRow(i + 1, { registrationId: `r${i + 1}` }));
    const pages = standingsPages({ groups: [], overall: rows }, 10);
    expect(pages.map((p) => p.label)).toEqual(['Classificação geral · parte 1 de 3', 'Classificação geral · parte 2 de 3', 'Classificação geral · parte 3 de 3']);
    expect(pages.map((p) => p.rows.length)).toEqual([10, 10, 3]);
  });

  it('um grupo só vira "Classificação geral"', () => {
    const pages = standingsPages({ groups: [{ groupId: null, name: 'Geral', rows: [standingRow(1)] }], overall: [] });
    expect(pages[0]?.label).toBe('Classificação geral');
  });
});

describe('bracketPages', () => {
  it('mata-mata de 16: rodadas em janelas de até 3 colunas, rodada com mais de 4 confrontos em partes', () => {
    const stage = buildStage('SINGLE_ELIM', 16);
    const pages = bracketPages(stage.bracket());
    expect(pages.map((p) => p.columns.map((c) => c.label))).toEqual([
      ['Oitavas de final · parte 1 de 2', 'Oitavas de final · parte 2 de 2', 'Quartas de final'],
      ['Semifinal', 'Final'],
    ]);
    expect(pages[0]?.label).toBe('Oitavas de final · parte 1 de 2 → Quartas de final');
    expect(pages[1]?.columns[0]?.matches).toHaveLength(2);
  });

  it('eliminação dupla: páginas separadas por lado da chave', () => {
    const stage = buildStage('DOUBLE_ELIM', 8);
    const labels = bracketPages(stage.bracket()).map((p) => p.label);
    expect(labels.some((l) => l.startsWith('Vencedores · '))).toBe(true);
    expect(labels.some((l) => l.startsWith('Perdedores · '))).toBe(true);
    expect(labels.at(-1)).toBe('Final · Grande Final');
  });

  it('grupos: a rodada em andamento, uma página por grupo', () => {
    const stage = buildStage('GROUPS', 8, { groupCount: 2 });
    for (const m of stage.structure.matches.filter((n) => n.round === 1)) stage.play(m.id);
    const pages = bracketPages(stage.bracket());
    expect(pages.map((p) => p.label)).toEqual(['Rodada 2 · Grupo A', 'Rodada 2 · Grupo B']);
    expect(pages.every((p) => p.columns.length === 1)).toBe(true);
  });

  it('sem partidas, nenhuma página', () => {
    expect(bracketPages({ format: 'ROUND_ROBIN', matches: [] })).toEqual([]);
  });
});
