'use client';

import { LegalDocument } from '@/features/admin/settings/LegalDocument';

/** Termos de Uso: o texto é o que o Super Admin publica em Configurações. */
export default function TermsPage() {
  return <LegalDocument doc="terms" />;
}
