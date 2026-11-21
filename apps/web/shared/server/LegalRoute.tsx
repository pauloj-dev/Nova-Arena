/**
 * Rota dos documentos legais (`/termos`, `/privacidade`). O texto que o Super Admin publica vem no HTML (#111): a
 * consulta `site/settings` já chega preenchida no navegador e o documento aparece sem esperar o JavaScript.
 * Com a API simulada (protótipo) não há dados no servidor e o documento carrega no navegador, como antes.
 */
import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query';
import { LegalDocument } from '@/features/admin/settings/LegalDocument';
import { keys } from '@/shared/api/keys';
import { getPublicSiteSettings } from './public-data';

export async function LegalRoute({ doc }: { doc: 'terms' | 'privacy' }) {
  const settings = await getPublicSiteSettings();
  const client = new QueryClient();
  if (settings) client.setQueryData(keys.site.settings, settings);
  return (
    <HydrationBoundary state={dehydrate(client)}>
      <LegalDocument doc={doc} />
    </HydrationBoundary>
  );
}
