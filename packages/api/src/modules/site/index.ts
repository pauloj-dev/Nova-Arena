/**
 * Configurações do site, feature flags e saúde do sistema (issue #94, ADM-09, ADM-10, RF-25). Porta das rotas de
 * `apps/web/mocks/handlers/admin-settings.ts` (o 2FA de lá é de outra frente, #95).
 *
 * - `GET /site/settings` e `GET /site/flags` (públicos): o que o site lê, pelo Edge Config quando configurado.
 * - `GET /admin/settings`, `GET /admin/flags` (Admin) e `PUT /admin/settings`, `PUT /admin/flags/:key` (**só o Super
 *   Admin**, auditados, só o que mudou). A mudança aparece no site sem novo deploy (`store.ts`).
 * - `GET /admin/health`: estado real das dependências (banco, Redis, QStash + falhas de jobs, Ably, Blob, e-mail),
 *   versão publicada (`VERCEL_GIT_COMMIT_SHA`) e falhas de jobs em aberto.
 */
import { audited, withAudit } from '@nova/db';
import { FeatureFlag, FeatureFlagInput, FeatureFlags, PublicSiteSettings, SiteSettings, SystemHealth } from '@nova/schemas';
import { list } from '@vercel/blob';
import { Hono } from 'hono';
import { z } from 'zod';
import { auditContext, requireAdmin, requireSuperAdmin } from '../../auth/admin';
import { body, respond, type AppEnv, type DependencyCheck } from '../../context';
import type { Env } from '../../env';
import { notFound } from '../../errors';
import { sentryErrorStats, SENTRY_ATTENTION_PER_HOUR, type ErrorTrackingStatus } from '../../observability';
import { cronHeartbeatKey } from '../../jobs/runner';
import { markUnchanged } from './events';
import { FLAG_KEYS, FLAG_TEXT, FLAGS_KEY, isFlagKey, loadFlags, loadSettings, publishSiteChange, SETTINGS_KEY, siteFlags, siteSettings, toFeatureFlag, toPublicSettings } from './store';

export { isFlagEnabled } from './store';

export const site = new Hono<AppEnv>();

// ── Configurações ────────────────────────────────────────────────────
/** Só os campos que mudaram. Textos longos entram resumidos, para a auditoria continuar legível. */
export function settingsDiff(before: SiteSettings, after: SiteSettings): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const summarize = (key: string, value: unknown): unknown => {
    if ((key === 'termsHtml' || key === 'privacyHtml') && typeof value === 'string') return `texto com ${value.length} caracteres`;
    if (key === 'homeBanners' && Array.isArray(value)) return (value as SiteSettings['homeBanners']).map((b) => b.title);
    return value;
  };
  const out = { before: {} as Record<string, unknown>, after: {} as Record<string, unknown> };
  for (const key of Object.keys(after) as (keyof SiteSettings)[]) {
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
    out.before[key] = summarize(key, before[key]);
    out.after[key] = summarize(key, after[key]);
  }
  return out;
}

site.get('/admin/settings', async (c) => {
  await requireAdmin(c);
  return respond(c, SiteSettings, await loadSettings(c.get('deps').db()));
});

/** Matriz do PRD §6: o Super Admin edita; o Admin só lê. */
site.put('/admin/settings', async (c) => {
  await requireSuperAdmin(c);
  const input = await body(c, SiteSettings);
  const db = c.get('deps').db();
  const current = await loadSettings(db);
  const diff = settingsDiff(current, input);
  if (Object.keys(diff.after).length === 0) {
    markUnchanged(c);
    return respond(c, SiteSettings, current);
  }
  await withAudit(db, await auditContext(c), async (tx) => {
    await tx.siteSetting.upsert({ where: { key: SETTINGS_KEY }, create: { key: SETTINGS_KEY, value: input }, update: { value: input } });
    await audited(tx, { action: 'SETTINGS_CHANGED', entityType: 'SiteSettings', entityId: 'site', entityLabel: 'Configurações do site', before: diff.before, after: diff.after });
  });
  await publishSiteChange(c, SETTINGS_KEY, input);
  return respond(c, SiteSettings, input);
});

site.get('/site/settings', async (c) => {
  // Navegador sempre confere (sem "stale-while-revalidate" no navegador: quem muda a configuração vê na hora); a CDN
  // da Vercel guarda por pouco tempo.
  c.header('Cache-Control', 'public, max-age=0, must-revalidate');
  c.header('CDN-Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  return respond(c, PublicSiteSettings, toPublicSettings(await siteSettings(c)));
});

// ── Feature flags ────────────────────────────────────────────────────
site.get('/admin/flags', async (c) => {
  await requireAdmin(c);
  const flags = await loadFlags(c.get('deps').db());
  return respond(
    c,
    z.array(FeatureFlag),
    FLAG_KEYS.map((key) => toFeatureFlag(key, flags[key])),
  );
});

site.put('/admin/flags/:key', async (c) => {
  await requireSuperAdmin(c);
  const key = c.req.param('key');
  if (!isFlagKey(key)) throw notFound('Recurso');
  const { enabled } = await body(c, FeatureFlagInput);
  const db = c.get('deps').db();
  const flags = await loadFlags(db);
  if (flags[key] === enabled) {
    markUnchanged(c);
    return respond(c, FeatureFlag, toFeatureFlag(key, enabled));
  }
  const next = { ...flags, [key]: enabled };
  await withAudit(db, await auditContext(c), async (tx) => {
    await tx.siteSetting.upsert({ where: { key: FLAGS_KEY }, create: { key: FLAGS_KEY, value: next }, update: { value: next } });
    await audited(tx, { action: 'FLAG_CHANGED', entityType: 'FeatureFlag', entityId: key, entityLabel: FLAG_TEXT[key].label, before: { enabled: flags[key] }, after: { enabled } });
  });
  await publishSiteChange(c, FLAGS_KEY, next);
  return respond(c, FeatureFlag, toFeatureFlag(key, enabled));
});

/** Público: o site lê daqui para ligar e desligar recursos sem novo deploy. */
site.get('/site/flags', async (c) => {
  // O navegador não reaproveita resposta velha (o Super Admin desliga uma flag e confere na hora); a CDN guarda 30 s.
  c.header('Cache-Control', 'public, max-age=0, must-revalidate');
  c.header('CDN-Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
  return respond(c, FeatureFlags, await siteFlags(c));
});

// ── Saúde do sistema ─────────────────────────────────────────────────
const CHECK_TIMEOUT_MS = 3000;
type ServiceStatus = SystemHealth['services'][number]['status'];

async function probe(check: () => Promise<'ok' | 'not_configured'>): Promise<{ status: ServiceStatus; latencyMs: number | null; error: string | null; configured: boolean }> {
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`sem resposta em ${CHECK_TIMEOUT_MS / 1000} s`)), CHECK_TIMEOUT_MS);
    });
    const result = await Promise.race([check(), timeout]);
    if (result === 'not_configured') return { status: 'degraded', latencyMs: null, error: null, configured: false };
    return { status: 'ok', latencyMs: Math.round(performance.now() - started), error: null, configured: true };
  } catch (error) {
    return { status: 'down', latencyMs: Math.round(performance.now() - started), error: error instanceof Error ? error.message : 'erro desconhecido', configured: true };
  } finally {
    clearTimeout(timer);
  }
}

/** Ably: a API REST responde (`/time`) e a chave existe. */
export const ablyCheck: DependencyCheck = async (env) => {
  if (!env.ABLY_API_KEY) return 'not_configured';
  const res = await fetch('https://rest.ably.io/time', { headers: { Authorization: `Basic ${Buffer.from(env.ABLY_API_KEY).toString('base64')}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return 'ok';
};

/** Vercel Blob: uma listagem de 1 item confirma o token. */
export const blobCheck: DependencyCheck = async (env) => {
  if (!env.BLOB_READ_WRITE_TOKEN) return 'not_configured';
  await list({ limit: 1, token: env.BLOB_READ_WRITE_TOKEN });
  return 'ok';
};

/** Resend: a chave só de envio não lista domínios (`restricted_api_key`), mas a resposta prova que ela vale. */
export const emailCheck: DependencyCheck = async (env) => {
  if (!env.RESEND_API_KEY) return 'not_configured';
  const res = await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } });
  if (res.ok) return 'ok';
  const data = (await res.json().catch(() => ({}))) as { name?: string };
  if (data.name === 'restricted_api_key') return 'ok';
  throw new Error(`HTTP ${res.status}`);
};

const detailOf = (r: { status: ServiceStatus; error: string | null; configured: boolean }, ok: string) => (r.status === 'down' ? `Fora do ar: ${r.error ?? 'erro desconhecido'}.` : r.configured ? ok : 'Ainda não configurado neste ambiente.');

/** Card do Cron: a varredura roda a cada minuto; mais de 5 min sem rodar é alerta (issue #116). */
export const CRON_STALE_MS = 5 * 60_000;
function cronCard(lastIso: string | null, now: Date, configured: boolean): { status: ServiceStatus; detail: string } {
  if (!lastIso) return { status: 'degraded', detail: configured ? 'A varredura do Cron ainda não rodou (ou o cache foi limpo). Confira Vercel → Cron Jobs.' : 'Cron ainda não configurado neste ambiente (CRON_SECRET).' };
  const minutes = Math.floor((now.getTime() - new Date(lastIso).getTime()) / 60_000);
  if (now.getTime() - new Date(lastIso).getTime() > CRON_STALE_MS) return { status: 'down', detail: `A varredura do Cron não roda há ${minutes} min (esperado: a cada minuto).` };
  return { status: 'ok', detail: minutes < 1 ? 'Varredura do Cron rodou há menos de 1 min.' : `Varredura do Cron rodou há ${minutes} min.` };
}

/** Card do Sentry na Saúde do Sistema. */
function errorsCard(e: ErrorTrackingStatus): { status: ServiceStatus; detail: string } {
  if (!e.configured) return { status: 'degraded', detail: 'Sentry ainda não configurado neste ambiente (SENTRY_DSN).' };
  if (e.eventsLastHour === null) {
    return { status: 'ok', detail: e.reason === 'no-read-token' ? 'Sentry recebendo erros. Para ver a contagem aqui, configure SENTRY_AUTH_TOKEN, SENTRY_ORG e SENTRY_PROJECT.' : 'Sentry recebendo erros; a contagem não respondeu agora.' };
  }
  const n = e.eventsLastHour;
  return { status: n >= SENTRY_ATTENTION_PER_HOUR ? 'degraded' : 'ok', detail: `${n} erro(s) recebido(s) pelo Sentry na última hora.` };
}

site.get('/admin/health', async (c) => {
  await requireAdmin(c);
  const env: Env = c.get('env');
  const { checks, db: getDb, now } = c.get('deps');
  const db = getDb();
  const dayAgo = new Date(now().getTime() - 24 * 3600_000);
  const [database, cache, queues, realtime, storage, email, failedJobs, recentFailures, storageBytes, errors, lastSweep] = await Promise.all([
    probe(() => checks.database(env)),
    probe(() => checks.redis(env)),
    probe(() => checks.qstash(env)),
    probe(() => ablyCheck(env)),
    probe(() => blobCheck(env)),
    probe(() => emailCheck(env)),
    db.jobFailure.count({ where: { resolvedAt: null } }),
    db.jobFailure.count({ where: { resolvedAt: null, createdAt: { gte: dayAgo } } }),
    db.upload.aggregate({ _sum: { size: true } }),
    sentryErrorStats(env, now()),
    c
      .get('deps')
      .cache(env)
      .get<string>(cronHeartbeatKey('cron:sweep'))
      .catch(() => null),
  ]);
  const storageUsedMb = Math.round(((storageBytes._sum.size ?? 0) / (1024 * 1024)) * 100) / 100;
  // Falha de job em aberto deixa a fila "com atenção" mesmo com o QStash no ar.
  const queueStatus: ServiceStatus = queues.status === 'ok' && failedJobs > 0 ? 'degraded' : queues.status;
  const queueDetail = queues.status === 'down' ? detailOf(queues, '') : failedJobs > 0 ? `${failedJobs} falha(s) de job em aberto (${recentFailures} nas últimas 24 horas).` : detailOf(queues, 'Nenhuma falha de job em aberto.');
  const services: SystemHealth['services'] = [
    { key: 'database', name: 'Banco de dados', status: database.status, detail: detailOf(database, 'Consultas respondendo normalmente.'), latencyMs: database.latencyMs },
    { key: 'cache', name: 'Cache', status: cache.status, detail: detailOf(cache, 'Redis respondendo.'), latencyMs: cache.latencyMs },
    { key: 'queues', name: 'Filas e tarefas agendadas', status: queueStatus, detail: queueDetail, latencyMs: queues.latencyMs },
    { key: 'realtime', name: 'Tempo real', status: realtime.status, detail: detailOf(realtime, 'Ably respondendo.'), latencyMs: realtime.latencyMs },
    { key: 'storage', name: 'Armazenamento de arquivos', status: storage.status, detail: storage.status === 'down' ? detailOf(storage, '') : `${storageUsedMb} MB em uso (provas, logos e banners).${storage.configured ? '' : ' Envio ainda não configurado neste ambiente.'}`, latencyMs: storage.latencyMs },
    { key: 'email', name: 'E-mail', status: email.status, detail: detailOf(email, 'Resend configurado e respondendo.'), latencyMs: email.latencyMs },
    { key: 'errors', name: 'Monitoramento de erros', ...errorsCard(errors), latencyMs: null },
    { key: 'cron', name: 'Tarefas de minuto em minuto (Cron)', ...cronCard(lastSweep, now(), Boolean(env.CRON_SECRET)), latencyMs: null },
  ];
  c.header('Cache-Control', 'no-store');
  return respond(c, SystemHealth, {
    version: env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
    environment: env.VERCEL_ENV ?? env.NODE_ENV,
    checkedAt: now().toISOString(),
    // Percentual de requisições com erro: medido na Vercel (Observability) e nos alertas do Sentry (docs/operacao.md).
    errorRate: null,
    errorTracking: { configured: errors.configured, eventsLastHour: errors.eventsLastHour },
    services,
    failedJobs,
    storageUsedMb,
  });
});
