import { LegalRoute } from '@/shared/server/LegalRoute';

/** Termos de Uso: o texto é o que o Super Admin publica em Configurações (vem pronto no HTML, revisto a cada 5 min). */
export const revalidate = 300;

export default function TermsPage() {
  return <LegalRoute doc="terms" />;
}
