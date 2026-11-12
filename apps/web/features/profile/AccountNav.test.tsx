import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountNav } from './AccountNav';

const pathname = vi.hoisted(() => ({ current: '/minha-conta' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));

function links() {
  const nav = screen.getByRole('navigation', { name: 'Minha conta' });
  return within(nav).getAllByRole('link');
}

describe('AccountNav', () => {
  afterEach(cleanup);

  it('lista as quatro áreas da conta, na ordem', () => {
    pathname.current = '/minha-conta';
    render(<AccountNav />);
    expect(links().map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Conta', '/minha-conta'],
      ['Squads', '/minha-conta/squads'],
      ['Campeonatos', '/minha-conta/campeonatos'],
      ['Segurança', '/minha-conta/seguranca'],
    ]);
  });

  it('"Conta" só fica ativa no caminho exato', () => {
    pathname.current = '/minha-conta';
    render(<AccountNav />);
    expect(screen.getByRole('link', { name: 'Conta' })).toHaveAttribute('aria-current', 'page');
    cleanup();

    pathname.current = '/minha-conta/seguranca';
    render(<AccountNav />);
    expect(screen.getByRole('link', { name: 'Conta' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Segurança' })).toHaveAttribute('aria-current', 'page');
  });

  it('subpáginas mantêm a área ativa', () => {
    pathname.current = '/minha-conta/squads/t_alfa';
    render(<AccountNav />);
    expect(screen.getByRole('link', { name: 'Squads' })).toHaveAttribute('aria-current', 'page');
    expect(links().filter((a) => a.getAttribute('aria-current') === 'page')).toHaveLength(1);
  });
});
