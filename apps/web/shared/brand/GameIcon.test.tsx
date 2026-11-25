/** Imagem do jogo com o emoji como reserva; decorativa (o nome do jogo aparece em texto ao lado). */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GameIcon } from './GameIcon';

describe('GameIcon', () => {
  it('mostra a imagem do catálogo, escondida do leitor de tela', () => {
    const { container } = render(<GameIcon icon="🔥" coverUrl="/jogos/free-fire.webp" className="size-10" px={40} />);
    const frame = container.firstElementChild as HTMLElement;
    expect(frame).toHaveAttribute('aria-hidden', 'true');
    const img = frame.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('alt')).toBe('');
    expect(img?.getAttribute('src')).toBe('/jogos/free-fire.webp');
    expect(img).toHaveAttribute('width', '40');
    expect(frame.textContent).toBe('');
  });

  it('sem imagem, fica o emoji', () => {
    const { container } = render(<GameIcon icon="⚽" coverUrl={null} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('⚽');
  });

  it('endereço externo cadastrado pelo Admin também funciona, com carregamento preguiçoso', () => {
    const { container } = render(<GameIcon icon="🎱" coverUrl="https://exemplo.com/capa.png" px={40} />);
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', 'https://exemplo.com/capa.png');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('width', '40');
  });

  it('no topo da página a imagem carrega antes (sem lazy)', () => {
    const { container } = render(<GameIcon icon="🔥" coverUrl="/jogos/free-fire.webp" priority />);
    expect(container.querySelector('img')).not.toHaveAttribute('loading');
  });
});
