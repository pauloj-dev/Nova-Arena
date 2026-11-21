/**
 * Tempo real (ADR-005): a API só **publica** eventos no Ably, por HTTP, depois do commit. Os navegadores
 * assinam os canais com um token emitido por `POST /realtime/token` (issue #97).
 *
 * Regras (plano §2.3): o evento leva só o que mudou — nunca dado sensível — e uma falha ao publicar nunca
 * derruba a requisição (vai para o log; o polling de 10 s das telas garante a consistência).
 */
import { RealtimeEvent, type RealtimeChannel } from '@nova/schemas';
import type { Env } from './env';
import type { Logger } from './logger';

export interface Realtime {
  publish(channel: RealtimeChannel, event: RealtimeEvent): Promise<void>;
}

/** Ably pela API REST (sem SDK no servidor). Sem `ABLY_API_KEY` (local, testes): só registra no log. */
export function ablyRealtime(env: Env, log: Logger): Realtime {
  const key = env.ABLY_API_KEY;
  if (!key) {
    return { publish: async (channel, event) => log.info('evento de tempo real não publicado (sem Ably neste ambiente)', { channel, type: event.type }) };
  }
  const auth = `Basic ${Buffer.from(key).toString('base64')}`;
  return {
    async publish(channel, event) {
      const parsed = RealtimeEvent.safeParse(event);
      if (!parsed.success) {
        log.error('evento de tempo real fora do contrato', { channel, type: event.type });
        return;
      }
      try {
        const res = await fetch(`https://rest.ably.io/channels/${encodeURIComponent(channel)}/messages`, {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: parsed.data.type, data: parsed.data }),
        });
        if (!res.ok) log.error('falha ao publicar no Ably', { channel, type: event.type, status: res.status });
      } catch (error) {
        log.error('falha ao publicar no Ably', { channel, type: event.type, error: error instanceof Error ? error.message : String(error) });
      }
    },
  };
}

/** Para testes: guarda o que foi publicado. */
export function memoryRealtime(): Realtime & { events: { channel: RealtimeChannel; event: RealtimeEvent }[] } {
  const events: { channel: RealtimeChannel; event: RealtimeEvent }[] = [];
  return {
    events,
    async publish(channel, event) {
      events.push({ channel, event: RealtimeEvent.parse(event) });
    },
  };
}
