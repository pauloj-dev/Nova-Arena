'use client';

import { cn } from '@nova/ui';
import { useMemo } from 'react';
import { sanitizeRichText } from '@/shared/lib/sanitize';

/** Estilo do texto formatado pelo organizador (só as tags que `sanitizeRichText` deixa passar). */
const prose = cn(
  'break-words text-sm leading-relaxed text-text md:text-base',
  '[&_p]:mb-3 [&_p:last-child]:mb-0',
  '[&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-lg [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-base [&_h4]:mb-1 [&_h4]:mt-3 [&_h4]:text-sm',
  '[&_h2:first-child]:mt-0 [&_h3:first-child]:mt-0 [&_h4:first-child]:mt-0',
  '[&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-1',
  '[&_a]:font-semibold [&_a]:text-primary-text [&_a]:underline [&_a]:underline-offset-2',
  '[&_blockquote]:mb-3 [&_blockquote]:border-l-4 [&_blockquote]:border-border-strong [&_blockquote]:pl-3 [&_blockquote]:text-muted',
  '[&_hr]:my-4 [&_hr]:border-border',
);

/**
 * Conteúdo escrito pelo organizador (descrição, regulamento, premiação).
 * O HTML **sempre** passa por `sanitizeRichText` antes de entrar na página: script, atributos de evento,
 * iframes e links `javascript:` são removidos.
 */
export function RichText({ html, className }: { html: string; className?: string }) {
  const clean = useMemo(() => sanitizeRichText(html), [html]);
  return <div className={cn(prose, className)} dangerouslySetInnerHTML={{ __html: clean }} />;
}
