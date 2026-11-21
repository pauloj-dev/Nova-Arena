/**
 * Ponto de integração com o Sentry para a Saúde do Sistema (issue #116).
 *
 * A taxa de erro "de verdade" (erros ÷ requisições) vem do painel da Vercel (Observability) e dos alertas do Sentry
 * (docs/operacao.md). Aqui a Saúde do Sistema mostra **quantos erros o Sentry recebeu na última hora**, pela API de
 * estatísticas do projeto (`GET /api/0/projects/{org}/{projeto}/stats/?stat=received&resolution=1h`), quando o
 * ambiente tem `SENTRY_AUTH_TOKEN` (escopo `project:read`), `SENTRY_ORG` e `SENTRY_PROJECT`.
 *
 * **Não validado contra uma conta real** (não havia conta do Sentry no desenvolvimento): o formato da resposta
 * (`[[timestamp, contagem], …]`) segue a documentação pública; se mudar, a Saúde mostra "sem dados", nunca quebra.
 */
import type { Env } from './env';

export interface ErrorTrackingStatus {
  /** O Sentry recebe erros neste ambiente (`SENTRY_DSN`). */
  configured: boolean;
  /** Erros recebidos na última hora; nulo sem as credenciais de leitura ou se a consulta falhar. */
  eventsLastHour: number | null;
  /** Motivo de `eventsLastHour` ser nulo (para o detalhe na tela). */
  reason: 'no-dsn' | 'no-read-token' | 'failed' | null;
}

/** Acima disto por hora, o card do Sentry fica "com atenção" na Saúde do Sistema. */
export const SENTRY_ATTENTION_PER_HOUR = 50;

export async function sentryErrorStats(env: Env, now: Date, fetcher: typeof fetch = fetch): Promise<ErrorTrackingStatus> {
  const configured = Boolean(env.SENTRY_DSN);
  if (!configured) return { configured, eventsLastHour: null, reason: 'no-dsn' };
  if (!env.SENTRY_AUTH_TOKEN || !env.SENTRY_ORG || !env.SENTRY_PROJECT) return { configured, eventsLastHour: null, reason: 'no-read-token' };
  const base = (env.SENTRY_API_URL ?? 'https://sentry.io').replace(/\/$/, '');
  const since = Math.floor(now.getTime() / 1000) - 3600;
  const url = `${base}/api/0/projects/${encodeURIComponent(env.SENTRY_ORG)}/${encodeURIComponent(env.SENTRY_PROJECT)}/stats/?stat=received&resolution=1h&since=${since}`;
  try {
    const res = await fetcher(url, { headers: { Authorization: `Bearer ${env.SENTRY_AUTH_TOKEN}` }, signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { configured, eventsLastHour: null, reason: 'failed' };
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) return { configured, eventsLastHour: null, reason: 'failed' };
    const total = data.reduce((sum: number, point: unknown) => (Array.isArray(point) && typeof point[1] === 'number' ? sum + point[1] : sum), 0);
    return { configured, eventsLastHour: total, reason: null };
  } catch {
    return { configured, eventsLastHour: null, reason: 'failed' };
  }
}
