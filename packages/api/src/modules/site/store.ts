/**
 * Configurações do site e feature flags (issue #94, ADM-09, ADM-10). Porta de `apps/web/mocks/handlers/admin-settings.ts`.
 *
 * - **Fonte de verdade: o banco** (`site_settings`, chaves `site` e `flags`). O painel grava lá, na mesma transação
 *   da auditoria, e só depois espelha no Edge Config.
 * - **Leitura pública rápida:** com `EDGE_CONFIG` configurado, `/site/flags`, `/site/settings` e `isFlagEnabled` leem
 *   do Edge Config (a mudança aparece no site sem deploy). Sem ele, ou se a chave ainda não existe lá, leem do banco
 *   por um cache curto (`site:*:v1`, 60 s, invalidado na gravação).
 * - **Gravação no Edge Config:** pela API REST da Vercel, quando `EDGE_CONFIG_ID` e `VERCEL_API_TOKEN` existem. Falha
 *   ao espelhar vai para o log (o banco já está certo; a próxima gravação espelha de novo).
 */
import type { Prisma, PrismaClient } from '@nova/db';
import { FEATURE_FLAG_DEFAULTS, SiteSettings, type FeatureFlag, type FeatureFlagKey, type PublicSiteSettings } from '@nova/schemas';
import { createClient } from '@vercel/edge-config';
import type { AppContext } from '../../context';
import type { Env } from '../../env';
import type { Logger } from '../../logger';

export const SETTINGS_KEY = 'site';
export const FLAGS_KEY = 'flags';
const CACHE_KEYS = { [SETTINGS_KEY]: 'site:settings:v1', [FLAGS_KEY]: 'site:flags:v1' } as const;
const CACHE_TTL_SECONDS = 60;

export const DEFAULT_SETTINGS: SiteSettings = {
  siteName: 'Nova Arena',
  logoUrl: null,
  homeBanners: [],
  termsHtml:
    '<h2>Termos de Uso</h2><p>A Nova Arena é uma plataforma para organizar e disputar campeonatos de eSports mobile. Ao criar uma conta você concorda com estas regras.</p><h3>Sua conta</h3><ul><li>Uma conta por pessoa. Contas duplicadas podem ser mescladas ou removidas.</li><li>Você responde pelo que acontece na sua conta. Não compartilhe a senha.</li></ul><h3>Jogo limpo</h3><ul><li>É proibido usar hacks, emuladores não autorizados ou a conta de outra pessoa.</li><li>Resultado falso, ofensa e assédio levam a advertência, suspensão ou banimento.</li></ul><h3>Campeonatos</h3><p>Cada campeonato tem o regulamento do organizador. A Nova Arena não é afiliada às empresas dos jogos.</p>',
  privacyHtml:
    '<h2>Política de Privacidade</h2><p>Guardamos só o que é preciso para os campeonatos funcionarem.</p><h3>O que coletamos</h3><ul><li>E-mail, apelido e data de nascimento, no cadastro.</li><li>IDs de jogo que você informa, visíveis para a organização dos campeonatos em que se inscreve.</li><li>Resultados, provas enviadas e registros de auditoria.</li></ul><h3>Seus direitos</h3><p>Você pode pedir a exclusão da conta a qualquer momento. O histórico de partidas é mantido de forma anônima.</p><p>Dúvidas: fale com o suporte.</p>',
  supportEmail: 'suporte@novaarena.gg',
  minAge: 16,
  requireApprovalForSeniorAdminRemoval: true,
};

export const FLAG_TEXT: Record<FeatureFlagKey, { label: string; description: string }> = {
  ranking: { label: 'Ranking', description: 'Página de ranking por jogo e o link "Ranking" no menu do site.' },
  publicSignup: { label: 'Cadastro aberto', description: 'Qualquer pessoa pode criar conta. Desligado, só entra quem já tem conta.' },
  resultSubmission: { label: 'Envio de resultado pelo participante', description: 'Capitães e jogadores enviam o placar com print. Desligado, só a organização lança resultados.' },
  pushNotifications: { label: 'Notificações push', description: 'Avisos no celular mesmo com o site fechado. Ainda em preparação.' },
  resultOcr: { label: 'Leitura do print (experimental)', description: 'Botão "Ler o print" no lançamento de queda e no envio de resultado: sugere colocação, kills e placar a partir da imagem, sempre com conferência antes de salvar.' },
};

export const FLAG_KEYS = Object.keys(FEATURE_FLAG_DEFAULTS) as FeatureFlagKey[];
export type FlagValues = Record<FeatureFlagKey, boolean>;

export const isFlagKey = (key: string): key is FeatureFlagKey => (FLAG_KEYS as string[]).includes(key);

type Reader = Pick<PrismaClient, 'siteSetting'> | Prisma.TransactionClient;

/** Configurações gravadas (o que faltar vem do padrão; formato antigo é completado sem quebrar). */
export async function loadSettings(db: Reader): Promise<SiteSettings> {
  const row = await db.siteSetting.findUnique({ where: { key: SETTINGS_KEY } });
  const parsed = SiteSettings.safeParse({ ...DEFAULT_SETTINGS, ...((row?.value as object | null) ?? {}) });
  return parsed.success ? parsed.data : structuredClone(DEFAULT_SETTINGS);
}

/** Flags gravadas, completadas com os padrões de `FEATURE_FLAG_DEFAULTS` (flag nova nasce com o padrão). */
export async function loadFlags(db: Reader): Promise<FlagValues> {
  const row = await db.siteSetting.findUnique({ where: { key: FLAGS_KEY } });
  return mergeFlags(row?.value);
}

export function mergeFlags(value: unknown): FlagValues {
  const stored = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return Object.fromEntries(FLAG_KEYS.map((key) => [key, typeof stored[key] === 'boolean' ? stored[key] : FEATURE_FLAG_DEFAULTS[key]])) as FlagValues;
}

export const toFeatureFlag = (key: FeatureFlagKey, enabled: boolean): FeatureFlag => ({ key, label: FLAG_TEXT[key].label, description: FLAG_TEXT[key].description, enabled });

export function toPublicSettings(s: SiteSettings): PublicSiteSettings {
  return { siteName: s.siteName, logoUrl: s.logoUrl, homeBanners: s.homeBanners, termsHtml: s.termsHtml, privacyHtml: s.privacyHtml, supportEmail: s.supportEmail, minAge: s.minAge };
}

// ── Edge Config ──────────────────────────────────────────────────────
const edgeClients = new Map<string, ReturnType<typeof createClient>>();

async function readEdge<T>(env: Env, key: string, log: Logger): Promise<T | undefined> {
  if (!env.EDGE_CONFIG) return undefined;
  try {
    let client = edgeClients.get(env.EDGE_CONFIG);
    if (!client) {
      client = createClient(env.EDGE_CONFIG);
      edgeClients.set(env.EDGE_CONFIG, client);
    }
    return await client.get<T>(key);
  } catch (error) {
    log.warn('Edge Config indisponível: lendo do banco', { key, error: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
}

/** Espelha no Edge Config pela API da Vercel. Sem `EDGE_CONFIG_ID`/`VERCEL_API_TOKEN`, não faz nada. Nunca lança. */
export async function mirrorToEdgeConfig(env: Env, log: Logger, items: Record<string, unknown>, fetcher: typeof fetch = fetch): Promise<'mirrored' | 'skipped' | 'failed'> {
  if (!env.EDGE_CONFIG_ID || !env.VERCEL_API_TOKEN) return 'skipped';
  const url = new URL(`https://api.vercel.com/v1/edge-config/${encodeURIComponent(env.EDGE_CONFIG_ID)}/items`);
  if (env.VERCEL_TEAM_ID) url.searchParams.set('teamId', env.VERCEL_TEAM_ID);
  try {
    const res = await fetcher(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${env.VERCEL_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: Object.entries(items).map(([key, value]) => ({ operation: 'upsert', key, value })) }),
    });
    if (!res.ok) {
      log.error('não foi possível gravar no Edge Config', { status: res.status, keys: Object.keys(items) });
      return 'failed';
    }
    return 'mirrored';
  } catch (error) {
    log.error('não foi possível gravar no Edge Config', { keys: Object.keys(items), error: error instanceof Error ? error.message : String(error) });
    return 'failed';
  }
}

// ── Leitura pública (site) ───────────────────────────────────────────
async function cachedFromDb<T>(c: AppContext, key: keyof typeof CACHE_KEYS, load: () => Promise<T>): Promise<T> {
  const cache = c.get('deps').cache(c.get('env'));
  const hit = await cache.get<T>(CACHE_KEYS[key]).catch(() => null);
  if (hit !== null) return hit;
  const value = await load();
  await cache.set(CACHE_KEYS[key], value, CACHE_TTL_SECONDS).catch((error: unknown) => c.get('log').warn('cache das configurações indisponível', { error: String(error) }));
  return value;
}

/** Flags como o site vê: Edge Config quando configurado; senão o banco (com cache curto). */
export async function siteFlags(c: AppContext): Promise<FlagValues> {
  const edge = await readEdge<Record<string, unknown>>(c.get('env'), FLAGS_KEY, c.get('log'));
  if (edge !== undefined) return mergeFlags(edge);
  return cachedFromDb(c, FLAGS_KEY, () => loadFlags(c.get('deps').db()));
}

/** Configurações como o site vê (mesma origem das flags). */
export async function siteSettings(c: AppContext): Promise<SiteSettings> {
  const edge = await readEdge<Record<string, unknown>>(c.get('env'), SETTINGS_KEY, c.get('log'));
  if (edge !== undefined) {
    const parsed = SiteSettings.safeParse({ ...DEFAULT_SETTINGS, ...edge });
    if (parsed.success) return parsed.data;
  }
  return cachedFromDb(c, SETTINGS_KEY, () => loadSettings(c.get('deps').db()));
}

/**
 * Recurso ligado? Para os outros módulos (ex.: `publicSignup` no cadastro, `resultSubmission` no envio de resultado,
 * `ranking`). Na dúvida (falha de leitura), vale o padrão de `FEATURE_FLAG_DEFAULTS`.
 */
export async function isFlagEnabled(c: AppContext, key: FeatureFlagKey): Promise<boolean> {
  try {
    return (await siteFlags(c))[key];
  } catch (error) {
    c.get('log').warn('não foi possível ler a flag: usando o padrão', { key, error: error instanceof Error ? error.message : String(error) });
    return FEATURE_FLAG_DEFAULTS[key];
  }
}

/** Depois de gravar no banco: invalida o cache e espelha no Edge Config. */
export async function publishSiteChange(c: AppContext, key: keyof typeof CACHE_KEYS, value: unknown): Promise<void> {
  await c
    .get('deps')
    .cache(c.get('env'))
    .del(CACHE_KEYS[key])
    .catch(() => undefined);
  await mirrorToEdgeConfig(c.get('env'), c.get('log'), { [key]: value });
}
