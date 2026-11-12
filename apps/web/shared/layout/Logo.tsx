import Link from 'next/link';

export function Logo({ href = '/', className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={`flex items-center gap-2 font-display text-xl font-bold tracking-wide ${className ?? ''}`} aria-label="Nova Arena — página inicial">
      <span className="size-3 rounded-full bg-primary-500" aria-hidden />
      NOVA ARENA
    </Link>
  );
}
