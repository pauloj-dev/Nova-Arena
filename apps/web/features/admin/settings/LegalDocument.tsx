'use client';

import { ErrorState, Skeleton } from '@nova/ui';
import { useMemo } from 'react';
import { errorMessage } from '@/shared/api/client';
import { usePublicSiteSettings } from '@/shared/api/hooks/admin-settings';
import { PageContainer } from '@/shared/layout/AreaShell';
import { sanitizeRichText } from '@/shared/lib/sanitize';

const DOCS = {
  terms: { title: 'Termos de Uso', field: 'termsHtml' },
  privacy: { title: 'Política de Privacidade', field: 'privacyHtml' },
} as const;

/** Remove o primeiro título do texto quando ele repete o título da página (a página já tem o seu `<h1>`). */
function withoutLeadingTitle(html: string, title: string): string {
  const match = /^\s*<h[1-4][^>]*>(.*?)<\/h[1-4]>/i.exec(html);
  return match && match[1]?.replace(/<[^>]+>/g, '').trim().toLowerCase() === title.toLowerCase() ? html.slice(match[0].length) : html;
}

/**
 * Página pública de Termos ou de Privacidade. O texto vem das configurações do site e é sempre
 * sanitizado antes de ir para a tela (`sanitizeRichText`): só títulos, parágrafos, listas, ênfase e links.
 */
export function LegalDocument({ doc }: { doc: keyof typeof DOCS }) {
  const settings = usePublicSiteSettings();
  const { title, field } = DOCS[doc];
  const raw = settings.data?.[field];
  const html = useMemo(() => (raw === undefined ? '' : sanitizeRichText(withoutLeadingTitle(raw, title))), [raw, title]);

  return (
    <PageContainer narrow>
      <h1 className="text-xl md:text-2xl">{title}</h1>
      {settings.isPending ? (
        <div className="flex flex-col gap-3" role="status" aria-label={`Carregando ${title}`}>
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-11/12" />
          <Skeleton className="h-5 w-4/5" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : settings.isError ? (
        <ErrorState description={errorMessage(settings.error)} onRetry={() => void settings.refetch()} />
      ) : html.trim() === '' ? (
        <p className="rounded-lg border border-dashed border-border-strong px-6 py-10 text-center text-sm text-muted">Este texto ainda não foi publicado.</p>
      ) : (
        <>
          <div
            data-testid="legal-content"
            className="flex flex-col gap-3 text-base leading-relaxed text-text [overflow-wrap:anywhere] [&_a]:font-semibold [&_a]:text-primary-text [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-border-strong [&_blockquote]:pl-4 [&_h2]:mt-4 [&_h2]:text-lg [&_h3]:mt-3 [&_h3]:text-base [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6"
            // O HTML passou por `sanitizeRichText` logo acima.
            dangerouslySetInnerHTML={{ __html: html }}
          />
          <p className="border-t border-border pt-4 text-sm text-muted">
            Dúvidas? Fale com o suporte:{' '}
            <a href={`mailto:${settings.data.supportEmail}`} className="font-semibold text-primary-text hover:underline">
              {settings.data.supportEmail}
            </a>
          </p>
        </>
      )}
    </PageContainer>
  );
}
