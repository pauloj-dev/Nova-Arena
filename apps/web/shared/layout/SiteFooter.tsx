import Link from 'next/link';
import { InstallAppButton } from '../pwa/InstallAppButton';

const LINKS = [
  { href: '/ajuda', label: 'Ajuda' },
  { href: '/contato', label: 'Contato' },
  { href: '/manutencao', label: 'Situação do serviço' },
  { href: '/termos', label: 'Termos de Uso' },
  { href: '/privacidade', label: 'Privacidade' },
];

/** Rodapé das áreas pública e do participante, em todos os tamanhos (no celular fica acima da barra inferior). */
export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-4 px-4 py-6 text-sm text-muted md:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-1">
          <p>Nova Arena · Onde todo campeonato vira história.</p>
          <p>Plataforma independente, não afiliada às empresas dos jogos.</p>
        </div>
        <nav aria-label="Rodapé">
          <ul className="flex flex-wrap gap-x-1 gap-y-0">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="inline-flex min-h-11 items-center rounded-md px-2 font-medium text-text underline-offset-2 hover:underline">
                  {l.label}
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
