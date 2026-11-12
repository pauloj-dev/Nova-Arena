'use client';

import { LegalDocument } from '@/features/admin/settings/LegalDocument';

/** Política de Privacidade: o texto é o que o Super Admin publica em Configurações. */
export default function PrivacyPage() {
  return <LegalDocument doc="privacy" />;
}
