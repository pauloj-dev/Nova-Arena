/**
 * Senha fraca ou vazada (issue #69). Vale no cadastro, na redefinição, na troca e na primeira senha.
 *
 * - **Fraca:** lista curta das senhas mais usadas no Brasil e no mundo, e senha que repete o apelido ou o e-mail.
 * - **Vazada:** Have I Been Pwned por k-anonimato (só os 5 primeiros caracteres do SHA-1 saem do servidor;
 *   a senha nunca). Sem conta nem chave. Se o serviço não responder em 2 s, a senha passa (falha aberta,
 *   registrada no log): ficar fora do ar não pode impedir o cadastro.
 */
import { weakPasswordReason } from '@nova/schemas';
import { createHash } from 'node:crypto';
import type { AppContext } from '../context';
import type { Env } from '../env';
import { HttpProblem } from '../errors';

export { weakPasswordReason };

/** Verdadeiro quando a senha aparece em vazamentos conhecidos. */
export type BreachCheck = (env: Env, password: string) => Promise<boolean>;

export const hibpBreachCheck: BreachCheck = async (env, password) => {
  // Testes e desenvolvimento sem rede não consultam o serviço.
  if (env.NODE_ENV === 'test') return false;
  const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, { headers: { 'Add-Padding': 'true', 'User-Agent': 'nova-arena' }, signal: AbortSignal.timeout(2000) });
  if (!res.ok) throw new Error(`HIBP respondeu HTTP ${res.status}`);
  const body = await res.text();
  return body.split('\n').some((line) => {
    const [hash, count] = line.trim().split(':');
    return hash === suffix && Number(count) > 0;
  });
};

/** Recusa (400 `WEAK_PASSWORD`, no campo informado) senha fraca ou vazada. */
export async function assertStrongPassword(c: AppContext, password: string, opts: { field?: string; nickname?: string | null; email?: string | null } = {}): Promise<void> {
  const field = opts.field ?? 'password';
  const weak = weakPasswordReason(password, opts);
  if (weak) throw new HttpProblem(400, weak, 'WEAK_PASSWORD', { [field]: weak });
  let breached = false;
  try {
    breached = await c.get('deps').breached(c.get('env'), password);
  } catch (error) {
    c.get('log').warn('checagem de senha vazada indisponível; senha aceita', { error: error instanceof Error ? error.message : String(error) });
  }
  if (breached) {
    const title = 'Essa senha apareceu em vazamentos de outros sites. Escolha uma senha que você não usa em outro lugar.';
    throw new HttpProblem(400, title, 'BREACHED_PASSWORD', { [field]: title });
  }
}
