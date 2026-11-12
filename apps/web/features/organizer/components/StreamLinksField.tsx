'use client';

import { Button, Input } from '@nova/ui';
import { Plus, Trash2 } from 'lucide-react';

const MAX_LINKS = 4;

interface StreamLinksFieldProps {
  value: string[];
  onChange: (value: string[]) => void;
  /** Erro de cada link, pelo índice. */
  errors?: (string | undefined)[];
  disabled?: boolean;
}

/** Links de transmissão: só Twitch e YouTube (PRD §5.2). */
export function StreamLinksField({ value, onChange, errors = [], disabled }: StreamLinksFieldProps) {
  return (
    <fieldset className="flex flex-col gap-3" disabled={disabled}>
      <legend className="text-sm font-medium text-text">Links de transmissão</legend>
      <p className="text-xs text-muted">Opcional. Aceitamos links da Twitch e do YouTube; o vídeo aparece na página do campeonato.</p>
      {value.map((link, index) => (
        <div key={index} className="flex items-start gap-2">
          <Input
            className="min-w-0 flex-1"
            label={`Link de transmissão ${index + 1}`}
            hideLabel
            type="url"
            inputMode="url"
            placeholder="https://www.twitch.tv/seucanal"
            value={link}
            error={errors[index]}
            onChange={(e) => onChange(value.map((v, i) => (i === index ? e.target.value : v)))}
          />
          <Button variant="ghost" aria-label={`Remover link de transmissão ${index + 1}`} onClick={() => onChange(value.filter((_, i) => i !== index))} className="shrink-0 px-3">
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </div>
      ))}
      {value.length < MAX_LINKS && (
        <div>
          <Button variant="secondary" size="sm" iconLeft={<Plus className="size-4" aria-hidden />} onClick={() => onChange([...value, ''])}>
            Adicionar link
          </Button>
        </div>
      )}
    </fieldset>
  );
}
