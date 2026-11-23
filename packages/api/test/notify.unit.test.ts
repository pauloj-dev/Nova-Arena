import { describe, expect, it } from 'vitest';
import { memoryRealtime } from '../src/realtime';

describe('tempo real em memória (testes)', () => {
  it('guarda o evento publicado e recusa evento fora do contrato', async () => {
    const rt = memoryRealtime();
    await rt.publish('tournament:t1', { type: 'standings.updated', stageId: 's1' });
    expect(rt.events).toEqual([{ channel: 'tournament:t1', event: { type: 'standings.updated', stageId: 's1' } }]);
    await expect(rt.publish('user:u1', { type: 'nao.existe' } as never)).rejects.toThrow();
  });
});
