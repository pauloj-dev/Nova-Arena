/**
 * Módulo `admin-settings` da API simulada (ADM-09, ADM-10 e RNF-08):
 * configurações do site, recursos liga/desliga (feature flags), saúde do sistema e verificação em duas etapas.
 *
 * Também guarda as duas checagens de acesso que os outros módulos `admin-*` usam:
 * `adminOnly()` (Admin ou Super Admin com 2FA ativo) e `superAdminOnly()`.
 */
import { http, type HttpHandler } from 'msw';
import {
  FEATURE_FLAG_DEFAULTS,
  FeatureFlagInput,
  SiteSettings,
  TwoFactorDisableInput,
  TwoFactorEnableInput,
  TwoFactorResetInput,
  type FeatureFlag,
  type FeatureFlagKey,
  type PublicSiteSettings,
  type SystemHealth,
  type TwoFactorStatus,
} from '@nova/schemas';
import { generateRecoveryCodes, generateSecret, otpauthUrl, secondsToNextStep, totp, verifyTotp } from '../../features/profile/security/totp';
import { qrSvg } from '../../features/profile/security/qr';
import { audit } from '../audit';
import { collection, db, nowIso, save, type DbUser } from '../db';
import { badRequest, body, conflict, forbidden, handle, hasRole, HttpProblem, isAdmin, json, notFound, param, requireAdmin, requireUser, url } from '../http';
import { notify } from '../notify';

export const moduleName = 'admin-settings';

// ── Acesso à área de administração ───────────────────────────────────
/** Admin ou Super Admin, com a verificação em duas etapas ativa (RNF-08: sem 2FA, `/admin/*` responde 403). */
export function adminOnly(): DbUser {
  const user = requireAdmin();
  if (!user.twoFactorEnabled) throw new HttpProblem(403, 'Ative a verificação em duas etapas para usar a área de administração.', 'TWO_FACTOR_REQUIRED');
  return user;
}

/** Só o Super Admin (configurações globais, flags, aprovar remoção de Admin, redefinir 2FA). */
export function superAdminOnly(): DbUser {
  const user = adminOnly();
  if (!hasRole(user, 'SUPER_ADMIN')) throw forbidden('Só o Super Admin pode fazer isso.');
  return user;
}

// ── Configurações do site ────────────────────────────────────────────
const DEFAULT_SETTINGS: SiteSettings = {
  siteName: 'Nova Arena',
  logoUrl: null,
  homeBanners: [{ id: 'hb_1', title: 'Copa Nova FF — Squad: inscrições abertas', link: '/c/copa-nova-ff-squad', imageUrl: null }],
  termsHtml:
    '<h2>Termos de Uso</h2><p>A Nova Arena é uma plataforma para organizar e disputar campeonatos de eSports mobile. Ao criar uma conta você concorda com estas regras.</p><h3>Sua conta</h3><ul><li>Uma conta por pessoa. Contas duplicadas podem ser mescladas ou removidas.</li><li>Você responde pelo que acontece na sua conta. Não compartilhe a senha.</li></ul><h3>Jogo limpo</h3><ul><li>É proibido usar hacks, emuladores não autorizados ou a conta de outra pessoa.</li><li>Resultado falso, ofensa e assédio levam a advertência, suspensão ou banimento.</li></ul><h3>Campeonatos</h3><p>Cada campeonato tem o regulamento do organizador. A Nova Arena não é afiliada às empresas dos jogos.</p>',
  privacyHtml:
    '<h2>Política de Privacidade</h2><p>Guardamos só o que é preciso para os campeonatos funcionarem.</p><h3>O que coletamos</h3><ul><li>E-mail, apelido e data de nascimento, no cadastro.</li><li>IDs de jogo que você informa, visíveis para a organização dos campeonatos em que se inscreve.</li><li>Resultados, provas enviadas e registros de auditoria.</li></ul><h3>Seus direitos</h3><p>Você pode pedir a exclusão da conta a qualquer momento. O histórico de partidas é mantido de forma anônima.</p><p>Dúvidas: fale com o suporte.</p>',
  supportEmail: 'suporte@novaarena.gg',
  minAge: 16,
  requireApprovalForSeniorAdminRemoval: true,
};

const settingsStore = () => collection<SiteSettings>('siteSettings', () => [structuredClone(DEFAULT_SETTINGS)]);

export function siteSettings(): SiteSettings {
  const store = settingsStore();
  if (!store[0]) store.push(structuredClone(DEFAULT_SETTINGS));
  return store[0] as SiteSettings;
}

function toPublicSettings(s: SiteSettings): PublicSiteSettings {
  return { siteName: s.siteName, logoUrl: s.logoUrl, homeBanners: s.homeBanners, termsHtml: s.termsHtml, privacyHtml: s.privacyHtml, supportEmail: s.supportEmail, minAge: s.minAge };
}

/** Só os campos que mudaram. Textos longos entram resumidos, para a auditoria continuar legível. */
function settingsDiff(before: SiteSettings, after: SiteSettings): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const summarize = (key: string, value: unknown): unknown => {
    if ((key === 'termsHtml' || key === 'privacyHtml') && typeof value === 'string') return `texto com ${value.length} caracteres`;
    if (key === 'homeBanners' && Array.isArray(value)) return (value as SiteSettings['homeBanners']).map((b) => b.title);
    return value;
  };
  const out = { before: {} as Record<string, unknown>, after: {} as Record<string, unknown> };
  for (const key of Object.keys(after) as Array<keyof SiteSettings>) {
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
    out.before[key] = summarize(key, before[key]);
    out.after[key] = summarize(key, after[key]);
  }
  return out;
}

// ── Feature flags ────────────────────────────────────────────────────
const FLAG_TEXT: Record<FeatureFlagKey, { label: string; description: string }> = {
  ranking: { label: 'Ranking', description: 'Página de ranking por jogo e o link "Ranking" no menu do site.' },
  publicSignup: { label: 'Cadastro aberto', description: 'Qualquer pessoa pode criar conta. Desligado, só entra quem já tem conta.' },
  resultSubmission: { label: 'Envio de resultado pelo participante', description: 'Capitães e jogadores enviam o placar com print. Desligado, só a organização lança resultados.' },
  pushNotifications: { label: 'Notificações push', description: 'Avisos no celular mesmo com o site fechado. Ainda em preparação.' },
};

const flagStore = () =>
  collection<FeatureFlag>('featureFlags', () =>
    (Object.keys(FEATURE_FLAG_DEFAULTS) as FeatureFlagKey[]).map((key) => ({ key, label: FLAG_TEXT[key].label, description: FLAG_TEXT[key].description, enabled: FEATURE_FLAG_DEFAULTS[key] })),
  );

export function isFlagEnabled(key: FeatureFlagKey): boolean {
  return flagStore().find((f) => f.key === key)?.enabled ?? FEATURE_FLAG_DEFAULTS[key];
}

// ── Saúde do sistema (valores simulados no protótipo) ────────────────
/** Variação pequena e estável dentro de cada janela de 30 s, para a tela "respirar" sem pular a cada render. */
function wobble(seed: number, min: number, max: number): number {
  const tick = Math.floor(Date.now() / 30_000) + seed * 7919;
  const x = Math.sin(tick) * 10_000;
  return min + (x - Math.floor(x)) * (max - min);
}

function systemHealth(): SystemHealth {
  let storageUsedMb = 0;
  try {
    storageUsedMb = Math.round((JSON.stringify(db()).length / (1024 * 1024)) * 100) / 100;
  } catch {
    storageUsedMb = 0;
  }
  const ms = (seed: number, min: number, max: number) => Math.round(wobble(seed, min, max));
  return {
    version: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'protótipo',
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV || 'protótipo',
    checkedAt: nowIso(),
    errorRate: Math.round(wobble(1, 0.1, 0.6) * 100) / 100,
    services: [
      { key: 'database', name: 'Banco de dados', status: 'ok', detail: 'Consultas respondendo normalmente.', latencyMs: ms(2, 8, 24) },
      { key: 'cache', name: 'Cache', status: 'ok', detail: 'Listas e rankings em cache.', latencyMs: ms(3, 1, 6) },
      { key: 'queues', name: 'Filas e tarefas agendadas', status: 'ok', detail: 'Nenhuma mensagem com falha nas últimas 24 horas.', latencyMs: null },
      { key: 'realtime', name: 'Tempo real', status: 'ok', detail: 'Canais de campeonato e de usuário ativos.', latencyMs: ms(4, 30, 90) },
      { key: 'storage', name: 'Armazenamento de arquivos', status: 'ok', detail: `${storageUsedMb} MB em uso (provas, logos e banners).`, latencyMs: ms(5, 40, 120) },
      { key: 'email', name: 'E-mail', status: 'ok', detail: 'Fila de envio vazia.', latencyMs: null },
    ],
    failedJobs: 0,
    storageUsedMb,
  };
}

// ── Verificação em duas etapas (TOTP) ────────────────────────────────
interface DbTwoFactor {
  userId: string;
  /** Segredo em uso (Base32). Na API real fica cifrado; aqui é o banco simulado. */
  secret: string | null;
  /** Segredo gerado em `/me/2fa/setup`, ainda não confirmado com um código. */
  pendingSecret: string | null;
  /** Códigos de recuperação ainda não usados. Na API real ficam só os hashes. */
  recoveryCodes: string[];
  enabledAt: string | null;
}
const twoFactorStore = () => collection<DbTwoFactor>('twoFactor');

/** Registro de 2FA do usuário. Contas do seed que já nascem com 2FA ativo ganham um segredo na primeira leitura. */
function twoFactorOf(user: DbUser): DbTwoFactor {
  const store = twoFactorStore();
  let record = store.find((r) => r.userId === user.id);
  if (!record) {
    record = { userId: user.id, secret: null, pendingSecret: null, recoveryCodes: [], enabledAt: null };
    store.push(record);
  }
  if (user.twoFactorEnabled && !record.secret) {
    record.secret = generateSecret();
    record.enabledAt = user.createdAt;
    save();
  }
  return record;
}

function twoFactorStatus(user: DbUser): TwoFactorStatus {
  return { enabled: user.twoFactorEnabled, required: isAdmin(user), recoveryCodesLeft: user.twoFactorEnabled ? twoFactorOf(user).recoveryCodes.length : 0 };
}

const INVALID_CODE = () => new HttpProblem(400, 'Código incorreto ou vencido. Confira o aplicativo e tente de novo.', 'INVALID_CODE', { code: 'Código incorreto ou vencido.' });

function clearTwoFactor(user: DbUser): void {
  const store = twoFactorStore();
  const index = store.findIndex((r) => r.userId === user.id);
  if (index >= 0) store.splice(index, 1);
  user.twoFactorEnabled = false;
  save();
}

export const handlers: HttpHandler[] = [
  // ── Configurações ──────────────────────────────────────────────────
  http.get(
    url('/admin/settings'),
    handle(() => {
      adminOnly();
      return json(siteSettings());
    }),
  ),

  /** Matriz do PRD §6: o Super Admin edita; o Admin só lê. */
  http.put(
    url('/admin/settings'),
    handle(async ({ request }) => {
      const actor = superAdminOnly();
      const input = await body(request, SiteSettings);
      const current = siteSettings();
      const diff = settingsDiff(current, input);
      if (Object.keys(diff.after).length === 0) return json(current);
      Object.assign(current, input);
      save();
      audit(actor, { action: 'SETTINGS_CHANGED', entityType: 'SiteSettings', entityId: 'site', entityLabel: 'Configurações do site', before: diff.before, after: diff.after });
      return json(current);
    }),
  ),

  http.get(
    url('/site/settings'),
    handle(() => json(toPublicSettings(siteSettings()))),
  ),

  // ── Feature flags ──────────────────────────────────────────────────
  http.get(
    url('/admin/flags'),
    handle(() => {
      adminOnly();
      return json(flagStore());
    }),
  ),

  http.put(
    url('/admin/flags/:key'),
    handle(async ({ request, params }) => {
      const actor = superAdminOnly();
      const key = param(params, 'key');
      const flag = flagStore().find((f) => f.key === key);
      if (!flag) throw notFound('Recurso');
      const { enabled } = await body(request, FeatureFlagInput);
      if (flag.enabled !== enabled) {
        const before = flag.enabled;
        flag.enabled = enabled;
        save();
        audit(actor, { action: 'FLAG_CHANGED', entityType: 'FeatureFlag', entityId: flag.key, entityLabel: flag.label, before: { enabled: before }, after: { enabled } });
      }
      return json(flag);
    }),
  ),

  /** Público: o site lê daqui para ligar e desligar recursos sem novo deploy. */
  http.get(
    url('/site/flags'),
    handle(() => json(Object.fromEntries(flagStore().map((f) => [f.key, f.enabled])))),
  ),

  // ── Saúde do sistema ───────────────────────────────────────────────
  http.get(
    url('/admin/health'),
    handle(() => {
      adminOnly();
      return json(systemHealth());
    }),
  ),

  // ── 2FA ────────────────────────────────────────────────────────────
  http.get(
    url('/me/2fa'),
    handle(() => json(twoFactorStatus(requireUser()))),
  ),

  http.post(
    url('/me/2fa/setup'),
    handle(() => {
      const user = requireUser();
      if (user.twoFactorEnabled) throw conflict('A verificação em duas etapas já está ativa nesta conta.', 'TWO_FACTOR_ALREADY_ENABLED');
      const record = twoFactorOf(user);
      record.pendingSecret = generateSecret();
      save();
      const uri = otpauthUrl({ issuer: siteSettings().siteName, account: user.email, secret: record.pendingSecret });
      return json({ secret: record.pendingSecret, otpauthUrl: uri, qrSvg: qrSvg(uri) });
    }),
  ),

  http.post(
    url('/me/2fa/enable'),
    handle(async ({ request }) => {
      const user = requireUser();
      const { code } = await body(request, TwoFactorEnableInput);
      if (user.twoFactorEnabled) throw conflict('A verificação em duas etapas já está ativa nesta conta.', 'TWO_FACTOR_ALREADY_ENABLED');
      const record = twoFactorOf(user);
      if (!record.pendingSecret) throw conflict('Comece a configuração de novo para gerar um QR code.', 'TWO_FACTOR_NOT_STARTED');
      if (!(await verifyTotp(record.pendingSecret, code))) throw INVALID_CODE();
      const recoveryCodes = generateRecoveryCodes();
      record.secret = record.pendingSecret;
      record.pendingSecret = null;
      record.recoveryCodes = [...recoveryCodes];
      record.enabledAt = nowIso();
      user.twoFactorEnabled = true;
      save();
      audit(user, { action: 'TWO_FACTOR_CHANGED', entityType: 'User', entityId: user.id, entityLabel: user.nickname, before: { twoFactorEnabled: false }, after: { twoFactorEnabled: true } });
      // Os códigos de recuperação só aparecem nesta resposta.
      return json({ recoveryCodes });
    }),
  ),

  http.post(
    url('/me/2fa/disable'),
    handle(async ({ request }) => {
      const user = requireUser();
      const { code } = await body(request, TwoFactorDisableInput);
      if (!user.twoFactorEnabled) throw conflict('A verificação em duas etapas já está desligada.', 'TWO_FACTOR_NOT_ENABLED');
      // RNF-08: para Admin e Super Admin ela é obrigatória.
      if (isAdmin(user)) throw new HttpProblem(403, 'Administradores não podem desligar a verificação em duas etapas.', 'TWO_FACTOR_REQUIRED');
      const record = twoFactorOf(user);
      const typed = code.trim().toLowerCase();
      const recoveryIndex = record.recoveryCodes.indexOf(typed);
      const valid = recoveryIndex >= 0 || (record.secret !== null && (await verifyTotp(record.secret, typed)));
      if (!valid) throw INVALID_CODE();
      clearTwoFactor(user);
      audit(user, {
        action: 'TWO_FACTOR_CHANGED',
        entityType: 'User',
        entityId: user.id,
        entityLabel: user.nickname,
        before: { twoFactorEnabled: true },
        after: { twoFactorEnabled: false },
        reason: recoveryIndex >= 0 ? 'Desligada com código de recuperação' : null,
      });
      return json(twoFactorStatus(user));
    }),
  ),

  /** Só no protótipo: o código do momento, para a demonstração funcionar sem aplicativo autenticador. */
  http.get(
    url('/me/2fa/dev-code'),
    handle(async () => {
      const user = requireUser();
      const record = twoFactorOf(user);
      const secret = record.pendingSecret ?? record.secret;
      if (!secret) throw notFound('Configuração de duas etapas');
      return json({ code: await totp(secret), expiresInSeconds: secondsToNextStep() });
    }),
  ),

  /** Quem perdeu o autenticador e os códigos de recuperação: só o Super Admin redefine (lacuna do PRD). */
  http.post(
    url('/admin/users/:id/2fa/reset'),
    handle(async ({ request, params }) => {
      const actor = superAdminOnly();
      const target = db().users.find((u) => u.id === param(params, 'id'));
      if (!target) throw notFound('Usuário');
      const { reason } = await body(request, TwoFactorResetInput);
      if (target.id === actor.id) throw badRequest('Para a sua própria conta, use a página Segurança.', 'SELF_RESET');
      if (!target.twoFactorEnabled) throw conflict('Esta conta não tem a verificação em duas etapas ativa.', 'TWO_FACTOR_NOT_ENABLED');
      clearTwoFactor(target);
      audit(actor, { action: 'TWO_FACTOR_CHANGED', entityType: 'User', entityId: target.id, entityLabel: target.nickname, before: { twoFactorEnabled: true }, after: { twoFactorEnabled: false }, reason });
      notify(
        [target.id],
        'SANCTION',
        'Verificação em duas etapas redefinida',
        isAdmin(target) ? 'A administração redefiniu a sua verificação em duas etapas. Configure de novo para voltar a acessar a área de administração.' : 'A administração redefiniu a sua verificação em duas etapas. Você pode configurar de novo quando quiser.',
        '/minha-conta/seguranca',
      );
      return json(twoFactorStatus(target));
    }),
  ),
];
