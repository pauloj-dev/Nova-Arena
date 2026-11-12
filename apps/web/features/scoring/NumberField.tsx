'use client';

import { Input, type InputProps } from '@nova/ui';
import { useState } from 'react';

type NumberFieldProps = Omit<InputProps, 'value' | 'onChange' | 'type' | 'defaultValue'> & {
  value: number;
  onChange: (value: number) => void;
};

function parse(text: string): number | undefined {
  if (text.trim() === '') return undefined;
  const value = Number(text.replace(',', '.'));
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Campo numérico controlado. Guarda o texto digitado para a pessoa poder apagar tudo ou
 * digitar "-" e "1," sem o campo pular; só avisa quem usa quando o texto vira um número.
 */
export function NumberField({ value, onChange, onBlur, ...props }: NumberFieldProps) {
  const [text, setText] = useState(() => String(value));
  const [lastValue, setLastValue] = useState(value);

  // O valor mudou por fora (outra regra, atalho, reordenação): o texto acompanha.
  if (lastValue !== value) {
    setLastValue(value);
    if (parse(text) !== value) setText(String(value));
  }

  return (
    <Input
      {...props}
      type="number"
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        const next = parse(event.target.value);
        if (next !== undefined && next !== value) onChange(next);
      }}
      onBlur={(event) => {
        if (parse(text) === undefined) setText(String(value));
        onBlur?.(event);
      }}
    />
  );
}
