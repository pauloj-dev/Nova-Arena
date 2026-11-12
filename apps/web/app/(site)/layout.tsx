import { SiteShell } from '@/shared/layout/SiteShell';

/** Áreas pública e do participante (acento verde da marca). */
export default function SiteLayout({ children }: LayoutProps<'/'>) {
  return <SiteShell>{children}</SiteShell>;
}
