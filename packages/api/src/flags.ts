/**
 * Leitura de feature flag no servidor (usada pelo envio de resultado, issue #90). As configurações e flags do site são
 * de outra frente (B2.6, Edge Config + `site_settings`); até ela chegar, esta função lê a tabela `site_settings` e
 * aceita os dois formatos mais prováveis da gravação:
 * - chave `flags` com um objeto `{ resultSubmission: true, ... }` (valor booleano ou `{ enabled }`);
 * - chave `flag:<nome>` (ou `flags.<nome>`) com `true`/`false` ou `{ enabled }`.
 * Sem registro (ou com formato desconhecido), a flag vale **ligada** — o padrão de `FEATURE_FLAG_DEFAULTS` para as
 * flags ligadas, e o comportamento esperado enquanto ninguém desligou.
 */
import type { PrismaClient } from '@nova/db';
import type { FeatureFlagKey } from '@nova/schemas';

function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value && typeof value === 'object' && typeof (value as { enabled?: unknown }).enabled === 'boolean') return (value as { enabled: boolean }).enabled;
  return null;
}

export async function isFlagEnabled(db: PrismaClient, key: FeatureFlagKey): Promise<boolean> {
  const rows = await db.siteSetting.findMany({ where: { key: { in: ['flags', `flag:${key}`, `flags.${key}`] } } });
  for (const name of [`flag:${key}`, `flags.${key}`]) {
    const own = asBoolean(rows.find((r) => r.key === name)?.value);
    if (own !== null) return own;
  }
  const all = rows.find((r) => r.key === 'flags')?.value;
  const fromAll = all && typeof all === 'object' ? asBoolean((all as Record<string, unknown>)[key]) : null;
  return fromAll ?? true;
}
