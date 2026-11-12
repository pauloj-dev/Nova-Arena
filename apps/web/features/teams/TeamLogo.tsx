import { cn } from '@nova/ui';
import { Avatar } from 'radix-ui';

const sizes = { sm: 'size-9 text-[10px]', md: 'size-12 text-xs', lg: 'size-16 text-sm', xl: 'size-20 text-base' };

interface TeamLogoProps {
  tag: string;
  logoUrl: string | null;
  size?: keyof typeof sizes;
  className?: string;
}

/** Marca do squad: a logo enviada ou, sem logo, a tag. Decorativa: o nome do squad sempre aparece ao lado. */
export function TeamLogo({ tag, logoUrl, size = 'md', className }: TeamLogoProps) {
  return (
    <Avatar.Root
      aria-hidden
      className={cn('inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-md bg-accent-soft font-display font-bold uppercase tracking-wide text-accent-soft-text', sizes[size], className)}
    >
      {logoUrl && <Avatar.Image src={logoUrl} alt="" className="size-full object-cover" />}
      <Avatar.Fallback delayMs={logoUrl ? 300 : undefined}>{tag}</Avatar.Fallback>
    </Avatar.Root>
  );
}
