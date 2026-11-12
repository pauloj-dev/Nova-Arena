import Link from 'next/link';

export function Logo({ href = '/', className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap font-display text-base font-bold tracking-wide xs:gap-2 xs:text-lg md:text-xl ${className ?? ''}`} aria-label="Nova Arena — página inicial">
      <span className="size-3 rounded-full bg-primary-500" aria-hidden />
      NOVA ARENA
    </Link>
  );
}
