/**
 * "Tempo real" do protótipo: os handlers publicam eventos aqui depois de gravar,
 * exatamente onde a API real publicará no Ably depois do commit (plano §2.3).
 * Um BroadcastChannel leva o evento também para outras abas do mesmo navegador.
 */
import type { RealtimeChannel, RealtimeEvent } from '@nova/schemas';

export interface BusMessage {
  channel: RealtimeChannel;
  event: RealtimeEvent;
}
type Listener = (message: BusMessage) => void;

const listeners = new Set<Listener>();
let broadcast: BroadcastChannel | null = null;

function channel(): BroadcastChannel | null {
  if (broadcast || typeof BroadcastChannel === 'undefined') return broadcast;
  broadcast = new BroadcastChannel('nova-realtime');
  broadcast.onmessage = (e: MessageEvent<BusMessage>) => listeners.forEach((l) => l(e.data));
  return broadcast;
}

export function publish(target: RealtimeChannel, event: RealtimeEvent): void {
  const message: BusMessage = { channel: target, event };
  // Fora da pilha do handler: quem escuta só é avisado depois da resposta HTTP sair (como "depois do commit").
  setTimeout(() => {
    listeners.forEach((l) => l(message));
    channel()?.postMessage(message);
  }, 0);
}

export function subscribeBus(listener: Listener): () => void {
  channel();
  listeners.add(listener);
  return () => listeners.delete(listener);
}
