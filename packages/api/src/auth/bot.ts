/**
 * Proteção contra bots no cadastro e na recuperação de senha (issue #69) com o Vercel BotID: o script do
 * navegador (`apps/web/instrumentation-client.ts`) assina as requisições e a API confere aqui.
 * Fora da Vercel (local, CI) não há o que conferir: passa.
 */
import { checkBotId } from 'botid/server';
import type { IncomingHttpHeaders } from 'node:http';
import type { AppContext } from '../context';
import type { Env } from '../env';
import { HttpProblem } from '../errors';

/** Verdadeiro quando a requisição veio de um robô (que não seja um robô verificado, como buscadores). */
export type BotCheck = (env: Env, headers: Headers) => Promise<boolean>;

export const vercelBotCheck: BotCheck = async (env, headers) => {
  if (!env.VERCEL_ENV) return false;
  const plain: IncomingHttpHeaders = Object.fromEntries(headers.entries());
  const verdict = await checkBotId({ advancedOptions: { headers: plain } });
  return verdict.isBot && !verdict.isVerifiedBot;
};

export async function assertHuman(c: AppContext): Promise<void> {
  let bot = false;
  try {
    bot = await c.get('deps').botCheck(c.get('env'), c.req.raw.headers);
  } catch (error) {
    // Falha do serviço não bloqueia gente de verdade; o limite de tentativas continua valendo.
    c.get('log').warn('checagem de bot indisponível', { error: error instanceof Error ? error.message : String(error) });
  }
  if (bot) throw new HttpProblem(403, 'Não conseguimos confirmar que é você. Recarregue a página e tente de novo.', 'BOT_DETECTED');
}
