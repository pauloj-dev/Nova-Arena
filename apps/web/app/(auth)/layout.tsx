import { Logo } from '@/shared/layout/Logo';

/** Entrar, cadastrar, recuperar senha e convites: tela limpa, sem navegação. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-hero">
      <header className="px-4 py-4 text-white md:px-8">
        <Logo onColor />
      </header>
      <main id="conteudo" className="flex flex-1 items-start justify-center px-4 pb-10 pt-2 md:items-center md:pt-0">
        <div className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-lg md:p-8">{children}</div>
      </main>
    </div>
  );
}
