import { LegalRoute } from '@/shared/server/LegalRoute';

/** Política de Privacidade: o texto é o que o Super Admin publica em Configurações (vem pronto no HTML, revisto a cada 5 min). */
export const revalidate = 300;

export default function PrivacyPage() {
  return <LegalRoute doc="privacy" />;
}
