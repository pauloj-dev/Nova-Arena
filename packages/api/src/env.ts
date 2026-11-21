/**
 * Variáveis de ambiente da API, validadas com Zod quando ela sobe (catálogo completo em `.env.example`).
 *
 * Os serviços entram aos poucos (B1 → B2): cada variável é opcional no schema, mas quando existe precisa
 * estar no formato certo. Em produção (`VERCEL_ENV=production`) as dos serviços do núcleo são obrigatórias —
 * subir produção sem banco é erro de configuração, não "serviço desligado".
 */
import { z } from 'zod';

const optionalUrl = z.url({ message: 'Precisa ser uma URL.' }).optional();
const optionalSecret = z.string().min(1).optional();

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    VERCEL_ENV: z.enum(['development', 'preview', 'production']).optional(),
    VERCEL_GIT_COMMIT_SHA: z.string().optional(),
    NEXT_PUBLIC_SITE_URL: optionalUrl,

    DATABASE_URL: optionalUrl,
    DATABASE_URL_UNPOOLED: optionalUrl,
    KV_REST_API_URL: optionalUrl,
    KV_REST_API_TOKEN: optionalSecret,
    QSTASH_URL: optionalUrl,
    QSTASH_TOKEN: optionalSecret,
    QSTASH_CURRENT_SIGNING_KEY: optionalSecret,
    QSTASH_NEXT_SIGNING_KEY: optionalSecret,
    CRON_SECRET: optionalSecret,
    BLOB_READ_WRITE_TOKEN: optionalSecret,
    /** Loja privada do Blob (provas e denúncias). Sem ela, usa a mesma de `BLOB_READ_WRITE_TOKEN`. */
    BLOB_PRIVATE_READ_WRITE_TOKEN: optionalSecret,
    EDGE_CONFIG: optionalUrl,
    RESEND_API_KEY: optionalSecret,
    /** Remetente de um domínio verificado no Resend, ex.: "Nova Arena <nao-responda@novaarena.gg>". */
    EMAIL_FROM: z.string().min(3).optional(),
    /** Fora de produção, todos os e-mails vão para esta caixa (com o destinatário original no assunto). */
    EMAIL_TEST_INBOX: z.email().optional(),
    SENTRY_DSN: optionalUrl,
    ABLY_API_KEY: optionalSecret,
    AUTH_JWT_SECRET: z.string().min(32, 'Use pelo menos 32 caracteres aleatórios.').optional(),
    LOBBY_ENCRYPTION_KEY: optionalSecret,
    /** Segredo TOTP do 2FA cifrado com AES-256-GCM (32 bytes em base64), issue #95. */
    TWO_FACTOR_ENCRYPTION_KEY: optionalSecret,
    /** Web Push (issue #109): par de chaves VAPID (`npx web-push generate-vapid-keys`) e o contato do remetente. */
    VAPID_PUBLIC_KEY: optionalSecret,
    VAPID_PRIVATE_KEY: optionalSecret,
    /** `mailto:` ou URL de contato exigido pelos serviços de push (ex.: `mailto:suporte@novaarena.gg`). */
    VAPID_SUBJECT: z.string().regex(/^(mailto:|https:\/\/)/, 'Use mailto: ou https://').optional(),
    GOOGLE_CLIENT_ID: optionalSecret,
    GOOGLE_CLIENT_SECRET: optionalSecret,
    DISCORD_CLIENT_ID: optionalSecret,
    DISCORD_CLIENT_SECRET: optionalSecret,
  })
  .superRefine((env, ctx) => {
    if (env.VERCEL_ENV !== 'production') return;
    for (const key of ['DATABASE_URL', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'QSTASH_TOKEN', 'NEXT_PUBLIC_SITE_URL', 'AUTH_JWT_SECRET', 'RESEND_API_KEY', 'EMAIL_FROM'] as const) {
      if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'Obrigatória em produção.' });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export class EnvError extends Error {
  constructor(readonly problems: Record<string, string>) {
    super(`Variáveis de ambiente inválidas: ${Object.entries(problems).map(([k, v]) => `${k} (${v})`).join(', ')}`);
    this.name = 'EnvError';
  }
}

/** Valida as variáveis. Lança `EnvError` com a lista do que está errado (sem mostrar os valores). */
export function parseEnv(source: Record<string, string | undefined>): Env {
  // Variável cadastrada vazia vale como "não cadastrada".
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ''));
  const parsed = EnvSchema.safeParse(cleaned);
  if (parsed.success) return parsed.data;
  const problems: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.join('.') || '_';
    if (!problems[key]) problems[key] = issue.message;
  }
  throw new EnvError(problems);
}

let cached: Env | undefined;

/** Variáveis do processo, validadas uma vez (na primeira requisição: o build não precisa delas). */
export function processEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
