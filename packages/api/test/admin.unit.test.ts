/** Peças do painel Admin sem banco: CSV, NPS, intervalo dos indicadores, flags, diff das configurações e o Edge Config. */
import { describe, expect, it } from 'vitest';
import { envFrom } from '../src';
import { createLogger } from '../src/logger';
import { csvCell } from '../src/modules/admin/audit';
import { nps, rangeOf } from '../src/modules/admin/stats';
import { settingsDiff } from '../src/modules/site';
import { DEFAULT_SETTINGS, mergeFlags, mirrorToEdgeConfig } from '../src/modules/site/store';

const log = createLogger(() => undefined);

describe('CSV da auditoria', () => {
  it('escapa aspas e ponto e vírgula e neutraliza fórmula', () => {
    expect(csvCell('texto simples')).toBe('texto simples');
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('diz "oi"')).toBe('"diz ""oi"""');
    expect(csvCell('=SOMA(A1)')).toBe("'=SOMA(A1)");
    expect(csvCell('+55 11')).toBe("'+55 11");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@user')).toBe("'@user");
    expect(csvCell(null)).toBe('');
    expect(csvCell({ status: 'ACTIVE' })).toBe('{""status"":""ACTIVE""}'.replace(/^/, '"').replace(/$/, '"'));
  });
});

describe('indicadores', () => {
  it('NPS = % promotores − % detratores', () => {
    expect(nps([])).toBeNull();
    expect(nps([10, 9, 8, 7])).toBe(50);
    expect(nps([0, 6, 9, 10])).toBe(0);
    expect(nps([3, 4])).toBe(-100);
  });

  it('intervalo: padrão de 30 dias, no máximo um ano e nunca no futuro', () => {
    const now = new Date('2026-11-21T12:00:00Z');
    const def = rangeOf(undefined, undefined, now);
    expect(def.to).toBe(now.getTime());
    expect(new Date(def.from).toISOString().slice(0, 10)).toBe('2026-10-23');
    const capped = rangeOf('2020-01-01', '2030-01-01', now);
    expect(capped.to).toBe(now.getTime());
    expect(now.getTime() - capped.from).toBe(365 * 24 * 3600_000);
    const day = rangeOf('2026-11-01', '2026-11-01', now);
    expect(new Date(day.from).toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(new Date(day.to).toISOString()).toBe('2026-11-01T23:59:59.999Z');
  });
});

describe('configurações e flags', () => {
  it('flag nova nasce com o padrão; valor gravado vale; lixo é ignorado', () => {
    expect(mergeFlags(null)).toEqual({ ranking: true, publicSignup: true, resultSubmission: true, pushNotifications: false });
    expect(mergeFlags({ ranking: false, pushNotifications: 'sim', outra: true })).toEqual({ ranking: false, publicSignup: true, resultSubmission: true, pushNotifications: false });
  });

  it('diff só com o que mudou; textos longos resumidos', () => {
    const diff = settingsDiff(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, minAge: 18, privacyHtml: '<p>x</p>', homeBanners: [{ id: 'b1', title: 'Copa', link: '/c/copa', imageUrl: null }] });
    expect(diff.before).toEqual({ minAge: 16, privacyHtml: `texto com ${DEFAULT_SETTINGS.privacyHtml.length} caracteres`, homeBanners: [] });
    expect(diff.after).toEqual({ minAge: 18, privacyHtml: 'texto com 8 caracteres', homeBanners: ['Copa'] });
    expect(settingsDiff(DEFAULT_SETTINGS, DEFAULT_SETTINGS).after).toEqual({});
  });

  it('espelha no Edge Config pela API da Vercel (upsert), com o time quando houver; sem token não faz nada', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = (async (url: URL | string, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    expect(await mirrorToEdgeConfig(envFrom({ NODE_ENV: 'test' }), log, { flags: {} }, fetcher)).toBe('skipped');
    const env = envFrom({ NODE_ENV: 'test', EDGE_CONFIG_ID: 'ecfg_123', VERCEL_API_TOKEN: 'tok', VERCEL_TEAM_ID: 'team_1' });
    expect(await mirrorToEdgeConfig(env, log, { flags: { ranking: false } }, fetcher)).toBe('mirrored');
    expect(calls[0]?.url).toBe('https://api.vercel.com/v1/edge-config/ecfg_123/items?teamId=team_1');
    expect(calls[0]?.init.method).toBe('PATCH');
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ items: [{ operation: 'upsert', key: 'flags', value: { ranking: false } }] });
    const failing = (async () => new Response('{}', { status: 403 })) as unknown as typeof fetch;
    expect(await mirrorToEdgeConfig(env, log, { flags: {} }, failing)).toBe('failed');
    const broken = (async () => {
      throw new Error('rede fora');
    }) as unknown as typeof fetch;
    expect(await mirrorToEdgeConfig(env, log, { flags: {} }, broken)).toBe('failed');
  });
});
