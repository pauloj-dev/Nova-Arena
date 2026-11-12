'use client';

import { cn } from '@nova/ui';
import { AlertCircle, ImagePlus, Loader2, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { uploadErrorMessage, uploadImage } from '@/shared/api/upload';

export interface EvidenceUploaderProps {
  /** URLs já enviadas (a ordem é a de envio). */
  value: string[];
  onChange: (urls: string[]) => void;
  /** `evidence`: print ou prova de resultado · `report`: anexo de denúncia. */
  purpose: 'evidence' | 'report';
  label: string;
  hint?: string;
  /** Máximo de imagens. */
  max?: number;
  required?: boolean;
  /** Erro de validação do formulário (ex.: "Anexe pelo menos um print"). */
  error?: string;
  /** Avisa o formulário enquanto há envio em andamento, para segurar o botão de enviar. */
  onBusyChange?: (busy: boolean) => void;
  className?: string;
}

/**
 * Anexos de imagem (prints e provas): escolhe, comprime e envia direto ao armazenamento,
 * mostra a miniatura e deixa remover. Usado no envio de resultado, na contestação,
 * nas mensagens da disputa e na denúncia.
 */
export function EvidenceUploader({ value, onChange, purpose, label, hint, max = 3, required, error, onBusyChange, className }: EvidenceUploaderProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const full = value.length + pending >= max;
  const message = uploadError ?? error;

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadError(null);
    const room = max - value.length;
    const chosen = Array.from(files).slice(0, room);
    if (files.length > room) setUploadError(max === 1 ? 'Só é possível anexar 1 imagem.' : `Só é possível anexar até ${max} imagens.`);
    if (chosen.length === 0) return;
    setPending(chosen.length);
    onBusyChange?.(true);
    const uploaded: string[] = [];
    for (const file of chosen) {
      try {
        uploaded.push(await uploadImage(file, purpose));
      } catch (e) {
        setUploadError(uploadErrorMessage(e));
      }
      setPending((n) => Math.max(0, n - 1));
    }
    setPending(0);
    onBusyChange?.(false);
    if (uploaded.length > 0) onChange([...value, ...uploaded]);
    // Permite escolher o mesmo arquivo de novo depois de remover.
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-text">
        {label}
        {required && (
          <span className="text-danger" aria-hidden>
            {' '}
            *
          </span>
        )}
      </label>

      <ul className="flex flex-wrap gap-2" aria-label="Imagens anexadas">
        {value.map((url, i) => (
          // Duas imagens iguais geram a mesma URL no protótipo (data URL): a posição entra na chave e na remoção.
          <li key={`${i}-${url.slice(-24)}`} className="relative size-20 overflow-hidden rounded-md border border-border bg-surface-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- miniatura de arquivo enviado pelo usuário (data URL no protótipo) */}
            <img src={url} alt={`Anexo ${i + 1}`} className="size-full object-cover" />
            <button
              type="button"
              onClick={() => onChange(value.filter((_, index) => index !== i))}
              aria-label={`Remover anexo ${i + 1}`}
              className="absolute right-0 top-0 flex size-8 items-center justify-center rounded-bl-md bg-surface text-text shadow-sm hover:bg-neutral-soft"
            >
              <X className="size-4" aria-hidden />
            </button>
          </li>
        ))}
        {pending > 0 && (
          <li className="flex size-20 items-center justify-center rounded-md border border-dashed border-border-strong text-muted" role="status" aria-label="Enviando imagem">
            <Loader2 className="size-5 animate-spin" aria-hidden />
          </li>
        )}
        {!full && (
          <li>
            <label
              htmlFor={id}
              className="flex size-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border-strong text-xs font-medium text-muted hover:bg-neutral-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-accent"
            >
              <ImagePlus className="size-5" aria-hidden />
              Anexar
              <input
                ref={inputRef}
                id={id}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple={max > 1}
                className="sr-only"
                aria-describedby={message ? `${id}-error` : hint ? `${id}-hint` : undefined}
                aria-invalid={message ? true : undefined}
                aria-required={required || undefined}
                onChange={(e) => void addFiles(e.target.files)}
              />
            </label>
          </li>
        )}
      </ul>

      {hint && !message && (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {message && (
        <p id={`${id}-error`} role="alert" className="flex items-center gap-1 text-xs font-medium text-danger">
          <AlertCircle className="size-3.5 shrink-0" aria-hidden />
          {message}
        </p>
      )}
    </div>
  );
}
