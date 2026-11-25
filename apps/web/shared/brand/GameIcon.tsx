/**
 * Imagem do jogo no catálogo (`coverUrl`), com o emoji como reserva quando o jogo não tem imagem. É decorativa:
 * o nome do jogo sempre aparece ao lado, em texto. O contêiner define o tamanho (ex.: `size-10`), a imagem o preenche.
 *
 * As imagens do catálogo ficam em `public/jogos/` (WebP de 160 px, 2 a 8 KB: cobrem até 80 px em tela de alta
 * densidade). Vão num `<img>` comum, sem o `next/image`: num ícone deste tamanho o otimizador não economiza nada e
 * custaria ~4 KB de JS em cada rota (teto de JS inicial, #111). Endereço de fora cadastrado pelo Admin também funciona.
 */
import { cn } from '@nova/ui';

interface GameIconProps {
  icon: string;
  coverUrl?: string | null;
  /** Tamanho e forma do quadro (ex.: `size-10 rounded-md text-xl`). */
  className?: string;
  /** Lado ocupado na tela, em px (largura e altura do `<img>`, para não deslocar o layout). */
  px?: number;
  /** Imagem no topo da página (candidata a LCP): carrega antes das outras. */
  priority?: boolean;
}

// Atributos de carregamento fora do JSX: são valores do HTML, não texto (a regra de texto fixo olha só o JSX).
const LAZY = { loading: 'lazy', decoding: 'async' } as const;
const EAGER = { fetchPriority: 'high', decoding: 'async' } as const;

export function GameIcon({ icon, coverUrl, className, px = 48, priority = false }: GameIconProps) {
  return (
    <span className={cn('flex shrink-0 items-center justify-center overflow-hidden bg-accent-soft', className)} aria-hidden>
      {coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- ícone pequeno: o next/image só acrescentaria JS
        <img src={coverUrl} alt="" width={px} height={px} className="size-full object-cover" {...(priority ? EAGER : LAZY)} />
      ) : (
        icon
      )}
    </span>
  );
}
