/**
 * Configurações do site, feature flags (com `isFlagEnabled`), saúde do sistema, eventos de produto, NPS e as métricas
 * do dashboard (#94, #101) contra o Postgres. Todas as mudanças das chaves globais (`site_settings`) ficam neste
 * arquivo, que roda em sequência — inclusive a regra da RN-11 que depende das configurações.
 */
import { createDb, type PrismaClient } from '@nova/db';
import { FeatureFlag, FeatureFlags, NpsAnswer, ProductMetrics, PublicSiteSettings, RoleRevokeResult, SiteSettings, SystemHealth } from '@nova/schemas';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../src';
import type { AppEnv } from '../src/context';
import { isFlagEnabled } from '../src/modules/site';
import { auditCount, createHarness, lastAudit, testEnv, type Harness } from './fixtures/admin';

const url = process.env.TEST_DATABASE_URL;
const DAY = 24 * 3600_000;

describe.skipIf(!url)('configurações, flags, saúde e métricas (Postgres)', () => {
  let db: PrismaClient;
  let h: Harness;
  let original: SiteSettings;
  let originalFlags: unknown;
  const id = (key: string) => h.people.get(key)?.id ?? '';

  beforeAll(async () => {
    db = createDb({ connectionString: url, max: 4 });
    h = createHarness(db, 'st', { VERCEL_GIT_COMMIT_SHA: 'abcdef1234567890', VERCEL_ENV: 'preview' });
    await h.makeUser('rafael', ['SUPER_ADMIN', 'ADMIN']);
    await h.makeUser('ana', ['ADMIN'], { createdAt: new Date(Date.now() - 300 * DAY) });
    await h.makeUser('novo', ['ADMIN']);
    await h.makeUser('bianca', []);
    await h.makeUser('camila', ['ORGANIZER']);
    original = SiteSettings.parse((await h.call('rafael', 'GET', '/admin/settings')).data);
    originalFlags = (await db.siteSetting.findUnique({ where: { key: 'flags' } }))?.value ?? null;
  });
  afterAll(async () => {
    // Devolve as chaves globais como estavam (outros arquivos de teste leem o padrão).
    await db.siteSetting.upsert({ where: { key: 'site' }, create: { key: 'site', value: original }, update: { value: original } });
    if (originalFlags) await db.siteSetting.update({ where: { key: 'flags' }, data: { value: originalFlags as object } });
    else await db.siteSetting.deleteMany({ where: { key: 'flags' } });
    await db.$disconnect();
  });

  it('PUT /admin/settings: Admin comum → 403; Super Admin → 200, só o que mudou na auditoria; salvar igual não registra', async () => {
    const next = { ...original, siteName: `Arena ${h.stamp}`.slice(0, 40), supportEmail: 'ajuda@novaarena.gg', termsHtml: '<p>Termos novos.</p>' };
    expect((await h.call('ana', 'PUT', '/admin/settings', next)).status).toBe(403);
    expect(SiteSettings.parse((await h.call('ana', 'GET', '/admin/settings')).data).siteName).toBe(original.siteName);
    expect((await h.call('rafael', 'PUT', '/admin/settings', { ...next, minAge: 10 })).status).toBe(400);
    const saved = await h.call('rafael', 'PUT', '/admin/settings', next);
    expect(saved.status).toBe(200);
    expect(SiteSettings.parse(saved.data).siteName).toBe(next.siteName);
    const log = await lastAudit(db, 'SETTINGS_CHANGED', { actorId: id('rafael') });
    expect(log).toMatchObject({ entityId: 'site', before: { siteName: original.siteName }, after: { siteName: next.siteName, supportEmail: 'ajuda@novaarena.gg', termsHtml: 'texto com 20 caracteres' } });
    expect(Object.keys(log?.after as object).sort()).toEqual(['siteName', 'supportEmail', 'termsHtml']);
    await h.call('rafael', 'PUT', '/admin/settings', next);
    expect(await auditCount(db, 'SETTINGS_CHANGED', { actorId: id('rafael') })).toBe(1);
  });

  it('GET /site/settings é público, vem do banco (cache curto, invalidado na gravação) e não expõe regras internas', async () => {
    const res = await h.call(null, 'GET', '/site/settings');
    expect(res.status).toBe(200);
    const settings = PublicSiteSettings.parse(res.data);
    expect(settings.siteName).toBe(`Arena ${h.stamp}`.slice(0, 40));
    expect(settings.termsHtml).toBe('<p>Termos novos.</p>');
    expect(res.data).not.toHaveProperty('requireApprovalForSeniorAdminRemoval');
    expect(res.res.headers.get('cache-control')).toContain('s-maxage');
  });

  it('com a regra da RN-11 desligada nas configurações, o Admin remove o mais antigo sem aprovação (o Super Admin segue protegido)', async () => {
    const current = SiteSettings.parse((await h.call('rafael', 'GET', '/admin/settings')).data);
    expect((await h.call('rafael', 'PUT', '/admin/settings', { ...current, requireApprovalForSeniorAdminRemoval: false })).status).toBe(200);
    try {
      const res = await h.call('novo', 'DELETE', `/admin/users/${id('ana')}/roles/ADMIN`);
      expect(res.status).toBe(200);
      expect(RoleRevokeResult.parse(res.data).outcome).toBe('REVOKED');
      expect(await db.userRole.count({ where: { userId: id('ana'), role: 'ADMIN' } })).toBe(0);
      expect((await h.call('novo', 'DELETE', `/admin/users/${id('rafael')}/roles/ADMIN`)).status).toBe(403);
    } finally {
      expect((await h.call('rafael', 'PUT', '/admin/settings', current)).status).toBe(200);
    }
  });

  it('flag alterada no painel muda GET /site/flags e isFlagEnabled() na hora (sem deploy); só o Super Admin altera', async () => {
    expect(FeatureFlags.parse((await h.call(null, 'GET', '/site/flags')).data)).toMatchObject({ ranking: true, publicSignup: true, resultSubmission: true, pushNotifications: false });
    const flags = z.array(FeatureFlag).parse((await h.call('novo', 'GET', '/admin/flags')).data);
    expect(flags.map((f) => f.key)).toEqual(['ranking', 'publicSignup', 'resultSubmission', 'pushNotifications', 'resultOcr']);
    expect((await h.call('novo', 'PUT', '/admin/flags/ranking', { enabled: false })).status).toBe(403);
    expect((await h.call('rafael', 'PUT', '/admin/flags/nao-existe', { enabled: false })).status).toBe(404);
    expect((await h.call('rafael', 'PUT', '/admin/flags/ranking', { enabled: 'não' })).status).toBe(400);

    // Outro módulo (outra instância da função, mesmo Redis) lendo a flag pelo helper exportado.
    const probe = new Hono<AppEnv>().get('/_flag/:key', async (c) => c.json({ on: await isFlagEnabled(c, c.req.param('key') as 'ranking') }));
    const other = createApp({ env: testEnv(), logSink: () => undefined, deps: { db: () => db, cache: () => h.cache }, extraModules: [probe] });
    const read = async () => ((await (await other.request('/api/v1/_flag/ranking')).json()) as { on: boolean }).on;
    expect(await read()).toBe(true);

    const res = await h.call('rafael', 'PUT', '/admin/flags/ranking', { enabled: false });
    expect(FeatureFlag.parse(res.data)).toMatchObject({ key: 'ranking', enabled: false });
    expect(await lastAudit(db, 'FLAG_CHANGED', { actorId: id('rafael') })).toMatchObject({ entityId: 'ranking', entityLabel: 'Ranking', before: { enabled: true }, after: { enabled: false } });
    expect(FeatureFlags.parse((await h.call(null, 'GET', '/site/flags')).data)).toMatchObject({ ranking: false, publicSignup: true });
    expect(await read()).toBe(false);
    // Repetir o mesmo valor não registra de novo.
    await h.call('rafael', 'PUT', '/admin/flags/ranking', { enabled: false });
    expect(await auditCount(db, 'FLAG_CHANGED', { actorId: id('rafael') })).toBe(1);
    await h.call('rafael', 'PUT', '/admin/flags/ranking', { enabled: true });
    expect(FeatureFlags.parse((await h.call(null, 'GET', '/site/flags')).data).ranking).toBe(true);
  });

  it('saúde do sistema: seis serviços com o estado real, versão publicada e falhas de jobs em aberto', async () => {
    const failure = await db.jobFailure.create({ data: { job: `cron:teste-${h.stamp}`, source: 'cron', error: 'quebrou' } });
    const health = SystemHealth.parse((await h.call('novo', 'GET', '/admin/health')).data);
    expect(health.services.map((s) => s.key)).toEqual(['database', 'cache', 'queues', 'realtime', 'storage', 'email']);
    expect(health.version).toBe('abcdef1');
    expect(health.environment).toBe('preview');
    expect(health.failedJobs).toBeGreaterThanOrEqual(1);
    expect(health.services.find((s) => s.key === 'database')?.status).toBe('ok');
    expect(health.services.find((s) => s.key === 'queues')).toMatchObject({ status: 'degraded' });
    // Sem chave do Ably, do Blob e do Resend neste ambiente: aparece como não configurado.
    expect(health.services.find((s) => s.key === 'realtime')).toMatchObject({ status: 'degraded', detail: 'Ainda não configurado neste ambiente.' });
    await db.jobFailure.update({ where: { id: failure.id }, data: { resolvedAt: new Date() } });
  });

  it('eventos de produto sem cookie: só do catálogo, sem texto livre; respondem 202 e não abrem sessão', async () => {
    const ok = await h.call('camila', 'POST', '/events', { name: 'result_entry_time', props: { durationMs: 42_000, kind: 'LOBBY' } });
    expect(ok.status).toBe(202);
    expect(ok.res.headers.get('set-cookie')).toBeNull();
    expect((await h.call(null, 'POST', '/events', { name: 'result_entry_time', props: { durationMs: 30_000, kind: 'LOBBY' } })).status).toBe(202);
    expect((await h.call(null, 'POST', '/events', { name: 'page_view', props: {} })).status).toBe(400);
    expect((await h.call(null, 'POST', '/events', { name: 'result_entry_time', props: { texto: 'x'.repeat(200) } })).status).toBe(400);
    const saved = await db.productEvent.findFirst({ where: { name: 'result_entry_time', userId: id('camila') }, orderBy: { id: 'desc' } });
    expect(saved?.props).toEqual({ durationMs: 42_000, kind: 'LOBBY' });
  });

  it('NPS depois do campeonato: só quem participou ou organizou, uma vez, com o campeonato encerrado', async () => {
    const game = await db.game.create({ data: { slug: `st-${h.stamp}`, name: `Jogo ST ${h.stamp}`, modes: { create: { name: '1x1', teamSize: 1, matchType: 'DUEL' } } }, include: { modes: true } });
    const tn = await db.tournament.create({ data: { slug: `st-copa-${h.stamp}`, name: 'Copa NPS', gameId: game.id, gameModeId: game.modes[0]?.id ?? '', ownerId: id('camila'), status: 'IN_PROGRESS', participantType: 'SOLO', maxParticipants: 8 } });
    await db.registration.create({ data: { tournamentId: tn.id, userId: id('bianca'), status: 'CONFIRMED' } });
    expect((await h.call('bianca', 'POST', '/me/nps', { tournamentId: tn.id, score: 9 })).code).toBe('NPS_NOT_OPEN');
    await db.tournament.update({ where: { id: tn.id }, data: { status: 'FINISHED' } });
    expect(NpsAnswer.parse((await h.call('bianca', 'POST', '/me/nps', { tournamentId: tn.id, score: 9 })).data)).toMatchObject({ as: 'PARTICIPANT', score: 9 });
    expect((await h.call('bianca', 'POST', '/me/nps', { tournamentId: tn.id, score: 10 })).code).toBe('NPS_ALREADY_ANSWERED');
    expect(NpsAnswer.parse((await h.call('camila', 'POST', '/me/nps', { tournamentId: tn.id, score: 6 })).data).as).toBe('ORGANIZER');
    expect((await h.call('novo', 'POST', '/me/nps', { tournamentId: tn.id, score: 8 })).code).toBe('NPS_NOT_ALLOWED');
    expect((await h.call('bianca', 'POST', '/me/nps', { tournamentId: tn.id, score: 11 })).status).toBe(400);
    expect((await h.call(null, 'POST', '/me/nps', { tournamentId: tn.id, score: 5 })).status).toBe(401);
  });

  it('métricas de produto: cada Key Result do PRD §3.2 e o HEART com valor, meta e situação; a North Star semanal', async () => {
    // Uma alteração do Admin auditada e uma sem mudança (não conta).
    await h.call('novo', 'POST', `/admin/users/${id('bianca')}/sanctions`, { type: 'WARNING', reason: 'Linguagem ofensiva' });
    const res = await h.call('novo', 'GET', '/admin/metrics');
    expect(res.status).toBe(200);
    const metrics = ProductMetrics.parse(res.data);
    const keys = metrics.metrics.map((m) => m.key);
    expect(keys).toEqual(['publishTime', 'noManualAdjustment', 'disputeRate', 'returnRate30d', 'walkoverRate', 'auditCoverage', 'npsParticipants', 'npsOrganizers', 'engagement', 'organizerAdoption', 'retention30d', 'brEntryTime']);
    expect(metrics.metrics.filter((m) => m.group === 'OKR')).toHaveLength(6);
    expect(metrics.northStar.weekly).toHaveLength(8);
    const by = Object.fromEntries(metrics.metrics.map((m) => [m.key, m]));
    expect(by.auditCoverage?.sample).toBeGreaterThan(0);
    expect(by.auditCoverage?.value).toBeGreaterThan(0);
    expect(by.npsParticipants?.sample).toBeGreaterThanOrEqual(1);
    expect(by.brEntryTime?.value).not.toBeNull();
    for (const m of metrics.metrics) expect(m.status === 'no_data').toBe(m.value === null);
    // Em cache por 5 min: a segunda leitura é igual.
    expect(ProductMetrics.parse((await h.call('novo', 'GET', '/admin/metrics')).data).generatedAt).toBe(metrics.generatedAt);
  });
});
