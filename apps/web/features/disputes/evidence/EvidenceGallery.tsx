'use client';

import { Modal, cn } from '@nova/ui';
import { useState } from 'react';
import { useT } from '@/shared/i18n/react';
import { messages } from '../messages';

export interface EvidenceGalleryProps {
  urls: string[];
  /** O que são as imagens, para o nome acessível: "Print", "Prova", "Anexo". */
  label?: string;
  className?: string;
}

/** Miniaturas das provas. Tocar abre a imagem inteira em um modal (sem sair da tela). */
export function EvidenceGallery({ urls, label: labelProp, className }: EvidenceGalleryProps) {
  const t = useT(messages, 'EvidenceGallery');
  const label = labelProp ?? t('anexo');
  const [open, setOpen] = useState<number | null>(null);
  if (urls.length === 0) return null;
  const current = open !== null ? urls[open] : undefined;
  const name = (i: number) => (urls.length > 1 ? t('numerado', { rotulo: label, n: i + 1 }) : label);
  return (
    <>
      <ul className={cn('flex flex-wrap gap-2', className)}>
        {urls.map((url, i) => (
          <li key={`${i}-${url.slice(-24)}`}>
            <button type="button" onClick={() => setOpen(i)} aria-label={t('abrir', { nome: name(i).toLowerCase() })} className="block size-16 overflow-hidden rounded-md border border-border bg-surface-2 hover:border-accent">
              {/* eslint-disable-next-line @next/next/no-img-element -- prova enviada pelo usuário (data URL no protótipo) */}
              <img src={url} alt="" className="size-full object-cover" />
            </button>
          </li>
        ))}
      </ul>
      <Modal open={open !== null} onOpenChange={(o) => !o && setOpen(null)} title={open !== null ? name(open) : label} size="lg">
        {current && (
          // eslint-disable-next-line @next/next/no-img-element -- prova enviada pelo usuário (data URL no protótipo)
          <img src={current} alt={open !== null ? name(open) : label} className="mx-auto max-h-[70vh] w-auto max-w-full rounded-md" />
        )}
      </Modal>
    </>
  );
}
