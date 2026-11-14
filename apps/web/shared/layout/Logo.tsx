import { cn } from '@nova/ui';
import Link from 'next/link';
import { LogoMark } from '../brand/LogoMark';

export interface LogoProps {
  href?: string;
  className?: string;
  /**
   * Em fundo colorido (cabeçalho das áreas, tela de login), o N do símbolo segue a cor do texto
   * do cabeçalho em vez da tinta da marca.
   */
  onColor?: boolean;
  /** Em telas bem estreitas mostra só o símbolo (o nome continua para o leitor de tela). */
  compact?: boolean;
}

/** Símbolo + nome. O link tem o nome acessível; o símbolo é decorativo para o leitor de tela. */
export function Logo({ href = '/', className, onColor = false, compact = false }: LogoProps) {
  return (
    <Link
      href={href}
      aria-label="Nova Arena — página inicial"
      className={cn(
        'group flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md font-display text-base font-bold tracking-wide focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent xs:text-lg md:gap-2.5 md:text-xl',
        onColor && '[--logo-ink:currentColor]',
        className,
      )}
    >
      <LogoMark className="h-7 w-auto shrink-0 transition-transform duration-200 ease-out group-hover:scale-105 motion-reduce:transition-none md:h-8" />
      <span className={cn('leading-none', compact && 'sr-only xs:not-sr-only')}>NOVA ARENA</span>
    </Link>
  );
}
