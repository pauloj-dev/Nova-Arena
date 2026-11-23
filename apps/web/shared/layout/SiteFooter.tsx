import Link from 'next/link';
import { getT } from '../i18n/core';
import { sharedMessages } from '../i18n/messages';
import { InstallAppButton } from '../pwa/InstallAppButton';

const LINKS = [
  { href: '/ajuda', label: 'ajuda' },
  { href: '/contato', label: 'contato' },
  { href: '/manutencao', label: 'situacao' },
  { href: '/termos', label: 'termos' },
  { href: '/privacidade', label: 'privacidade' },
] as const;

/** Rodapé das áreas pública e do participante, em todos os tamanhos (no celular fica acima da barra inferior). */
export function SiteFooter() {
  const t = getT(sharedMessages, 'SiteFooter');
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-4 px-4 py-6 text-sm text-muted md:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-1">
          <p>{t('slogan')}</p>
          <p>{t('independente')}</p>
        </div>
        <nav aria-label={t('rodape')}>
          <ul className="flex flex-wrap gap-x-1 gap-y-0">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="inline-flex min-h-11 items-center rounded-md px-2 font-medium text-text underline-offset-2 hover:underline">
                  {t(`links.${l.label}`)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <InstallAppButton />
      </div>
    </footer>
  );
}
