'use client';

import { Modal } from '@nova/ui';
import { useState } from 'react';

/** Provas anexadas ao resultado: miniaturas que abrem ampliadas (PRD §15.1, "confiança visível"). */
export function EvidenceGallery({ urls, label = 'Provas do resultado' }: { urls: string[]; label?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (urls.length === 0) return null;
  const current = open !== null ? urls[open] : undefined;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <ul className="flex flex-wrap gap-2" aria-label={label}>
        {urls.map((url, i) => (
          <li key={`${url}-${i}`}>
            <button
              type="button"
              onClick={() => setOpen(i)}
              aria-label={`Ampliar prova ${i + 1} de ${urls.length}`}
              className="relative z-10 block size-16 overflow-hidden rounded-md border border-border bg-surface-2 hover:border-accent"
            >
              {/* Imagem enviada pelos participantes (URL arbitrária): `next/image` exigiria liberar cada domínio. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" loading="lazy" className="size-full object-cover" />
            </button>
          </li>
        ))}
      </ul>
      <Modal open={open !== null} onOpenChange={(o) => !o && setOpen(null)} title={open !== null ? `Prova ${open + 1} de ${urls.length}` : 'Prova'} size="lg">
        {current && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={current} alt={`Print enviado como prova do resultado (${(open ?? 0) + 1} de ${urls.length})`} className="mx-auto max-h-[70vh] w-auto max-w-full rounded-md" />
        )}
      </Modal>
    </div>
  );
}
