'use client';

import { Input } from '@nova/ui';
import { useState, type ReactNode } from 'react';

interface NumberFieldProps {
  label: ReactNode;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  hint?: ReactNode;
  error?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}

/**
 * Campo de número inteiro. Só repassa valores dentro da faixa: enquanto a pessoa digita algo
 * incompleto ("" ou fora do limite) o valor anterior continua valendo, e ao sair do campo o
 * texto volta para um número válido.
 */
export function NumberField({ label, value, onChange, min, max, hint, error, disabled, className, id }: NumberFieldProps) {
  const [text, setText] = useState(() => (Number.isFinite(value) ? String(value) : ''));
  const [seen, setSeen] = useState(value);
  // O valor mudou por fora (modelo aplicado, troca de formato…): o texto acompanha.
  if (value !== seen) {
    setSeen(value);
    if (Number(text) !== value) setText(Number.isFinite(value) ? String(value) : '');
  }

  return (
    <Input
      id={id}
      label={label}
      hint={hint}
      error={error}
      className={className}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      step={1}
      disabled={disabled}
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const n = Number(raw);
        if (raw.trim() !== '' && Number.isInteger(n) && n >= min && n <= max) onChange(n);
      }}
      onBlur={() => {
        const n = Math.round(Number(text));
        const next = text.trim() === '' || !Number.isFinite(n) ? (Number.isFinite(value) ? value : min) : Math.min(max, Math.max(min, n));
        setText(String(next));
        if (next !== value) onChange(next);
      }}
    />
  );
}
