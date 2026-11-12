'use client';

import { cn } from '@nova/ui';
import { sanitizeRichText } from '@/shared/lib/sanitize';

/** Estilo do conteúdo em rich-text (o reset do Tailwind tira marcadores e tamanhos de título). */
export const RICH_TEXT_CLASS =
  'text-sm leading-relaxed text-text [&_a]:font-medium [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border-strong [&_blockquote]:pl-3 [&_blockquote]:text-muted ' +
  '[&_h2]:mt-3 [&_h2]:text-lg [&_h2]:font-bold [&_h3]:mt-3 [&_h3]:text-base [&_h3]:font-bold [&_h4]:mt-2 [&_h4]:font-semibold [&_hr]:my-3 [&_hr]:border-border ' +
  '[&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0';

/** Mostra o rich-text do organizador, sempre sanitizado no navegador antes de ir para a tela. */
export function RichTextView({ html, className, empty = 'Nada escrito ainda.' }: { html: string; className?: string; empty?: string }) {
  const clean = sanitizeRichText(html);
  if (clean.replace(/<[^>]*>/g, '').trim() === '') return <p className={cn('text-sm text-muted', className)}>{empty}</p>;
  return <div className={cn(RICH_TEXT_CLASS, className)} dangerouslySetInnerHTML={{ __html: clean }} />;
}
