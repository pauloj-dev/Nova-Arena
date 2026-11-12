import { describe, expect, it } from 'vitest';
import { countActiveFilters, EMPTY_FILTERS, hasAnyFilter, listHref, parseFilters, serializeFilters, toApiFilters, type ListFilters } from './filters';

const parse = (qs: string) => parseFilters(new URLSearchParams(qs));

describe('parseFilters', () => {
  it('URL sem parâmetros dá os filtros vazios', () => {
    expect(parse('')).toEqual(EMPTY_FILTERS);
  });

  it('lê todos os filtros', () => {
    expect(parse('q=copa&game=free-fire&mode=TEAM&status=open&from=2026-11-14&slots=available&verified=1')).toEqual({
      q: 'copa',
      game: 'free-fire',
      mode: 'TEAM',
      status: 'open',
      from: '2026-11-14',
      slots: true,
      verified: true,
    });
  });

  it('aceita modo e status em qualquer caixa', () => {
    expect(parse('mode=solo&status=LIVE')).toMatchObject({ mode: 'SOLO', status: 'live' });
  });

  it('ignora valores desconhecidos ou malformados em vez de quebrar', () => {
    expect(parse('mode=trio&status=ontem&from=14/11/2026&slots=1&verified=sim&game=Free%20Fire!')).toEqual(EMPTY_FILTERS);
    expect(parse('from=2026-02-31').from).toBe('');
  });

  it('apara e limita o texto da busca', () => {
    expect(parse('q=%20%20copa%20nova%20%20').q).toBe('copa nova');
    expect(parse(`q=${'a'.repeat(200)}`).q).toHaveLength(80);
  });

  it('ignora parâmetros que não são filtros (ex.: campanha)', () => {
    expect(parse('utm_source=discord&game=efootball')).toEqual({ ...EMPTY_FILTERS, game: 'efootball' });
  });
});

describe('serializeFilters', () => {
  it('filtros vazios não geram query string', () => {
    expect(serializeFilters(EMPTY_FILTERS)).toBe('');
    expect(listHref()).toBe('/campeonatos');
  });

  it('escreve só o que foi escolhido, em ordem estável', () => {
    const filters: ListFilters = { ...EMPTY_FILTERS, verified: true, game: 'free-fire', slots: true };
    expect(serializeFilters(filters)).toBe('game=free-fire&slots=available&verified=1');
    expect(listHref({ game: 'free-fire' })).toBe('/campeonatos?game=free-fire');
  });

  it('codifica o texto da busca', () => {
    expect(serializeFilters({ ...EMPTY_FILTERS, q: ' copa & liga ' })).toBe('q=copa+%26+liga');
  });

  it('ida e volta: o link reproduz exatamente os mesmos filtros', () => {
    const cases: ListFilters[] = [
      EMPTY_FILTERS,
      { q: 'copa nova', game: 'free-fire', mode: 'TEAM', status: 'open', from: '2026-11-14', slots: true, verified: true },
      { ...EMPTY_FILTERS, q: 'ç&=?#' },
      { ...EMPTY_FILTERS, mode: 'SOLO', status: 'finished' },
    ];
    for (const filters of cases) expect(parse(serializeFilters(filters))).toEqual(filters);
  });
});

describe('toApiFilters', () => {
  it('não manda filtros vazios para a API', () => {
    expect(toApiFilters(EMPTY_FILTERS)).toEqual({});
  });

  it('traduz os interruptores para os valores do contrato', () => {
    expect(toApiFilters({ ...EMPTY_FILTERS, game: 'free-fire', slots: true, verified: true, q: ' copa ' })).toEqual({ q: 'copa', game: 'free-fire', slots: 'available', verified: '1' });
  });
});

describe('contador de filtros ativos', () => {
  it('conta jogo, modo, status, data, vagas e verificado — a busca fica de fora', () => {
    expect(countActiveFilters(EMPTY_FILTERS)).toBe(0);
    expect(countActiveFilters({ ...EMPTY_FILTERS, q: 'copa' })).toBe(0);
    expect(countActiveFilters({ ...EMPTY_FILTERS, game: 'free-fire', slots: true })).toBe(2);
    expect(countActiveFilters({ q: 'x', game: 'a', mode: 'SOLO', status: 'open', from: '2026-01-01', slots: true, verified: true })).toBe(6);
  });

  it('hasAnyFilter considera também a busca', () => {
    expect(hasAnyFilter(EMPTY_FILTERS)).toBe(false);
    expect(hasAnyFilter({ ...EMPTY_FILTERS, q: 'copa' })).toBe(true);
    expect(hasAnyFilter({ ...EMPTY_FILTERS, verified: true })).toBe(true);
  });
});
