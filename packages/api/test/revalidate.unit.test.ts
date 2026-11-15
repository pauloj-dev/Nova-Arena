/** Revalidação das páginas públicas (issue #77): a API avisa o Next; falha no aviso não derruba a ação. */
import { describe, expect, it, vi } from 'vitest';
import { revalidateTournaments, revalidateUser, TOURNAMENTS_TAG } from '../src/revalidate';
import type { AppContext } from '../src/context';

function fakeContext(revalidate: (tags: string[]) => void) {
  const warn = vi.fn();
  const c = { get: (key: string) => (key === 'deps' ? { revalidate } : { warn }) } as unknown as AppContext;
  return { c, warn };
}

describe('revalidação', () => {
  it('campeonato e perfil usam as tags certas', () => {
    const revalidate = vi.fn();
    const { c } = fakeContext(revalidate);
    revalidateTournaments(c);
    revalidateUser(c, 'Bianca', 'bia');
    expect(revalidate.mock.calls).toEqual([[[TOURNAMENTS_TAG]], [['user:bianca', 'user:bia']]]);
  });

  it('erro ao revalidar só vai para o log', () => {
    const { c, warn } = fakeContext(() => {
      throw new Error('fora do Next');
    });
    expect(() => revalidateTournaments(c)).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });
});
