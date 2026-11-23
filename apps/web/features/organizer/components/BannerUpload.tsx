'use client';

import { Button } from '@nova/ui';
import { AlertCircle, ImagePlus, Trash2 } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { useT } from '@/shared/i18n/react';
import { BlobImage } from '@/shared/lib/blob-image';
import { BANNER_TYPES, fileToBannerDataUrl } from '../lib/banner';
import { messages } from '../messages';

interface BannerUploadProps {
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}

/** Banner do campeonato. No protótipo a imagem fica no próprio navegador (data URL). */
export function BannerUpload({ value, onChange, disabled }: BannerUploadProps) {
  const t = useT(messages, 'BannerUpload');
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await fileToBannerDataUrl(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('erroGenerico'));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="flex flex-col gap-2" role="group" aria-labelledby={`${id}-label`}>
      <span id={`${id}-label`} className="text-sm font-medium text-text">
        {t('titulo')}
      </span>
      <div className="overflow-hidden rounded-lg border border-dashed border-border-strong bg-surface-2">
        {value ? (
          <div className="relative aspect-[16/6] w-full">
            <BlobImage src={value} alt={t('previa')} sizes="(min-width: 768px) 640px, 100vw" className="object-cover" />
          </div>
        ) : (
          <div className="flex aspect-[16/6] w-full flex-col items-center justify-center gap-1 px-4 text-center text-sm text-muted">
            <ImagePlus className="size-6" aria-hidden />
            {t('semBanner')}
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={BANNER_TYPES.join(',')}
        className="hidden"
        data-testid="banner-input"
        tabIndex={-1}
        aria-hidden
        disabled={disabled || busy}
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" loading={busy} disabled={disabled} aria-describedby={`${id}-hint`} iconLeft={<ImagePlus className="size-4" aria-hidden />} onClick={() => inputRef.current?.click()}>
          {value ? t('trocarImagem') : t('escolherImagem')}
        </Button>
        {value && (
          <Button variant="ghost" size="sm" disabled={disabled} iconLeft={<Trash2 className="size-4" aria-hidden />} onClick={() => onChange(null)}>
            {t('removerBanner')}
          </Button>
        )}
      </div>
      {error ? (
        <p role="alert" className="flex items-center gap-1 text-xs font-medium text-danger">
          <AlertCircle className="size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {t('dica')}
        </p>
      )}
    </div>
  );
}
