import { cn } from '../lib/cn';

/**
 * Ilustração dos estados vazios (PRD §15.8): uma "arena" com a órbita da marca, um pódio e brilhos.
 * Feita só com as cores dos tokens (classes `fill-*`/`stroke-*`), então acompanha o tema claro e o escuro.
 * Decorativa: fica fora da árvore de acessibilidade.
 */
export function EmptyIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 176 112" className={cn('pointer-events-none', className)} aria-hidden="true" focusable="false">
      {/* Chão e halo */}
      <ellipse cx="88" cy="100" rx="70" ry="8" className="fill-neutral-soft" />
      <circle cx="88" cy="52" r="46" className="fill-accent-soft" />
      {/* Órbita da marca, inclinada */}
      <ellipse cx="88" cy="56" rx="78" ry="22" transform="rotate(-12 88 56)" className="fill-none stroke-accent" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="150 30 18 30" opacity="0.55" />
      {/* Pódio */}
      <rect x="50" y="78" width="24" height="20" rx="3" className="fill-silver" />
      <rect x="76" y="70" width="24" height="28" rx="3" className="fill-gold" />
      <rect x="102" y="84" width="24" height="14" rx="3" className="fill-bronze" />
      {/* Brilhos */}
      <path d="M24 26 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z" className="fill-gold" />
      <path d="M150 18 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" className="fill-accent" />
      <path d="M156 70 l2 4 4 2 -4 2 -2 4 -2 -4 -4 -2 4 -2z" className="fill-primary-500" opacity="0.8" />
      <circle cx="36" cy="70" r="3" className="fill-accent" opacity="0.7" />
      <circle cx="140" cy="44" r="2.5" className="fill-gold" />
      <circle cx="18" cy="52" r="2" className="fill-primary-500" opacity="0.6" />
    </svg>
  );
}
