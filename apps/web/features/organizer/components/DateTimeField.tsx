'use client';

import { Input } from '@nova/ui';
import type { ReactNode } from 'react';
import { formatDateTime, isoToLocalInput, localInputToIso, timeZoneLabel, userTimeZone } from '@/shared/lib/datetime';

interface DateTimeFieldProps {
  label: ReactNode;
  /** ISO em UTC, ou nulo quando ainda não foi definido. */
  value: string | null;
  onChange: (value: string | null) => void;
  error?: string;
  /** Texto de ajuda que aparece antes do fuso. */
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
}

/**
 * Data e hora digitadas no fuso de quem organiza e guardadas em UTC.
 * O fuso aparece sempre ao lado do campo (PRD §22, risco R8).
 */
export function DateTimeField({ label, value, onChange, error, hint, required, disabled, id }: DateTimeFieldProps) {
  const zone = userTimeZone();
  const zoneLabel = timeZoneLabel(zone, value ? new Date(value) : undefined);
  return (
    <Input
      id={id}
      label={
        <>
          {label} <span className="font-normal text-muted">({zoneLabel})</span>
        </>
      }
      type="datetime-local"
      required={required}
      disabled={disabled}
      error={error}
      hint={
        <>
          {hint ? `${hint} ` : ''}
          {value ? `Fica assim para quem vê: ${formatDateTime(value, { timeZone: zone })}.` : `Digite no ${zoneLabel}.`}
        </>
      }
      value={value ? isoToLocalInput(value, zone) : ''}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') {
          onChange(null);
          return;
        }
        try {
          onChange(localInputToIso(raw, zone));
        } catch {
          // Data incompleta enquanto a pessoa digita: mantém o valor anterior.
        }
      }}
    />
  );
}
