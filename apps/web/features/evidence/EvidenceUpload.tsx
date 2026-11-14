'use client';

import { Button, cn, Progress } from '@nova/ui';
import { AlertCircle, CheckCircle2, Paperclip, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { uploadErrorMessage, uploadImage, validateImage, type UploadProgress } from '@/shared/api/upload';

export const MAX_EVIDENCE = 6;

interface Item {
  id: string;
  name: string;
  status: 'uploading' | 'done' | 'error';
  /** 0 a 100 enquanto envia. */
  progress: number;
  phase: UploadProgress['phase'];
  /** Miniatura: o arquivo local enquanto envia; o endereço definitivo depois. */
  preview: string | null;
  url: string | null;
  error: string | null;
}

export interface EvidenceUploadProps {
  /** Endereços das provas já enviadas (na ordem de envio). */
  value: string[];
  onChange: (urls: string[]) => void;
  /** `evidence`: print ou prova de resultado · `report`: anexo de denúncia. */
  purpose?: 'evidence' | 'report';
  /** Texto do botão e nome do campo. */
  label?: string;
  /** Dica abaixo do campo (some quando há erro). */
  hint?: string;
  max?: number;
  required?: boolean;
  /** Erro de validação do formulário (ex.: "Anexe pelo menos um print"). */
  error?: string;
  /** Avisa quando há envio em andamento (para a tela não salvar no meio). */
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
  className?: string;
  /** Troca o envio (testes). */
  upload?: (file: File, onProgress: (p: UploadProgress) => void) => Promise<string>;
}

let counter = 0;
const nextId = () => `prova-${(counter += 1)}`;

const PHASE_LABEL: Record<UploadProgress['phase'], string> = {
  preparing: 'Preparando',
  uploading: 'Enviando',
};

/**
 * Anexo de provas: imagens com tipo e 5 MB conferidos antes de qualquer envio, compressão no navegador
 * e envio direto para o armazenamento, com miniatura, progresso real e erro por arquivo. Um arquivo com
 * erro não impede os outros. Usado no lançamento de resultado (organização), no envio e na contestação
 * de resultado, nas mensagens da disputa e na denúncia.
 */
export function EvidenceUpload({
  value,
  onChange,
  purpose = 'evidence',
  label = 'Anexar print',
  hint,
  max = MAX_EVIDENCE,
  required,
  error,
  onBusyChange,
  disabled,
  className,
  upload,
}: EvidenceUploadProps) {
  const inputId = useId();
  const messageId = `${inputId}-mensagem`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>(() => value.map((url, i) => ({ id: nextId(), name: `Prova ${i + 1}`, status: 'done', progress: 100, phase: 'uploading', preview: url, url, error: null })));
  const [notice, setNotice] = useState<string | null>(null);
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  });

  // A tela pode trocar o valor por fora (ex.: limpar os anexos depois de enviar a mensagem). Nesse caso
  // as provas concluídas passam a ser as do valor novo; envios em andamento e erros continuam na lista.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    const doneUrls = items.filter((i) => i.status === 'done').map((i) => i.url);
    const same = doneUrls.length === value.length && doneUrls.every((url, i) => url === value[i]);
    if (!same) {
      // Reaproveita os itens que continuam no valor (uma vez cada: a mesma URL pode aparecer duas vezes).
      const available = items.filter((i) => i.status === 'done');
      const done: Item[] = value.map((url, i) => {
        const at = available.findIndex((x) => x.url === url);
        if (at >= 0) return available.splice(at, 1)[0] as Item;
        return { id: nextId(), name: `Prova ${i + 1}`, status: 'done', progress: 100, phase: 'uploading', preview: url, url, error: null };
      });
      setItems([...done, ...items.filter((i) => i.status !== 'done')]);
    }
  }
  const localUrls = useRef<string[]>([]);

  const busy = items.some((i) => i.status === 'uploading');
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  // Libera as miniaturas locais ao sair da tela.
  useEffect(
    () => () => {
      for (const url of localUrls.current) URL.revokeObjectURL(url);
    },
    [],
  );

  const used = items.filter((i) => i.status !== 'error').length;
  const free = Math.max(0, max - used);
  const send = upload ?? ((file: File, onProgress: (p: UploadProgress) => void) => uploadImage(file, purpose, { onProgress }));

  function patch(id: string, change: Partial<Item>) {
    setItems((list) => list.map((item) => (item.id === id ? { ...item, ...change } : item)));
  }

  async function sendOne(id: string, file: File) {
    try {
      const url = await send(file, (p) => patch(id, { progress: p.percent, phase: p.phase }));
      patch(id, { status: 'done', progress: 100, url, preview: url, error: null });
      valueRef.current = [...valueRef.current, url];
      onChange(valueRef.current);
    } catch (e) {
      patch(id, { status: 'error', error: uploadErrorMessage(e) });
    }
  }

  function add(files: FileList | null) {
    if (!files || files.length === 0) return;
    const picked = [...files];
    const accepted = picked.slice(0, free);
    const left = picked.length - accepted.length;
    setNotice(left > 0 ? `Só cabem ${max} ${max === 1 ? 'imagem' : 'imagens'}. ${left === 1 ? '1 arquivo ficou' : `${left} arquivos ficaram`} de fora.` : null);
    const created: { item: Item; file: File | null }[] = accepted.map((file) => {
      const invalid = validateImage(file);
      if (invalid) return { item: { id: nextId(), name: file.name, status: 'error', progress: 0, phase: 'preparing', preview: null, url: null, error: invalid }, file: null };
      let preview: string | null = null;
      try {
        preview = URL.createObjectURL(file);
        localUrls.current.push(preview);
      } catch {
        preview = null;
      }
      return { item: { id: nextId(), name: file.name, status: 'uploading', progress: 0, phase: 'preparing', preview, url: null, error: null }, file };
    });
    setItems((list) => [...list, ...created.map((c) => c.item)]);
    for (const { item, file } of created) if (file) void sendOne(item.id, file);
    // Permite escolher o mesmo arquivo de novo depois de remover.
    if (inputRef.current) inputRef.current.value = '';
  }

  function remove(item: Item) {
    // Pela posição entre as concluídas, não pela URL: duas imagens iguais geram a mesma URL no protótipo.
    const doneIndex = items.filter((i) => i.status === 'done').findIndex((i) => i.id === item.id);
    setItems((list) => list.filter((i) => i.id !== item.id));
    if (item.status === 'done' && doneIndex >= 0) {
      valueRef.current = valueRef.current.filter((_, i) => i !== doneIndex);
      onChange(valueRef.current);
    }
  }

  const blocked = disabled || free === 0;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" disabled={blocked} iconLeft={<Paperclip className="size-4" aria-hidden />} onClick={() => inputRef.current?.click()}>
          {label}
          {required && (
            <span className="text-danger" aria-hidden>
              {' '}
              *
            </span>
          )}
        </Button>
        <span className="text-xs text-muted">
          {used} de {max} · PNG, JPG ou WebP de até 5 MB (a imagem é reduzida antes do envio)
        </span>
        <label htmlFor={inputId} className="sr-only">
          {label}: escolher imagens
        </label>
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple={max > 1}
          className="sr-only"
          tabIndex={-1}
          data-testid="evidence-input"
          disabled={blocked}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? messageId : undefined}
          onChange={(e) => add(e.target.files)}
        />
      </div>
      {hint && !error && (
        <p id={messageId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={messageId} role="alert" className="flex items-center gap-1 text-xs font-medium text-danger">
          <AlertCircle className="size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-xs font-medium text-warning-soft-text">
          {notice}
        </p>
      )}
      {items.length > 0 && (
        <ul className="grid grid-cols-1 gap-2 xs:grid-cols-2 md:grid-cols-3" aria-label="Provas anexadas">
          {items.map((item, index) => (
            <li key={item.id} className="flex items-center gap-2 rounded-md border border-border bg-surface p-2" data-status={item.status}>
              <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-surface-2">
                {item.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element -- miniatura de arquivo local ou data URL: não passa pelo otimizador
                  <img src={item.preview} alt={item.status === 'done' ? `Anexo ${index + 1}` : ''} className="size-full object-cover" />
                ) : (
                  <AlertCircle className="size-5 text-danger" aria-hidden />
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-xs font-medium text-text">{item.name}</span>
                {item.status === 'uploading' && (
                  <>
                    <Progress value={item.progress} max={100} label={`Enviando ${item.name}`} />
                    <span className="tabular text-xs text-muted">
                      {PHASE_LABEL[item.phase]} · {item.progress}%
                    </span>
                  </>
                )}
                {item.status === 'done' && (
                  <span className="flex items-center gap-1 text-xs text-primary-soft-text">
                    <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
                    Enviada
                  </span>
                )}
                {item.status === 'error' && (
                  <span role="alert" className="flex items-start gap-1 text-xs font-medium text-danger">
                    <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    {item.error}
                  </span>
                )}
              </span>
              <button
                type="button"
                className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted hover:bg-neutral-soft hover:text-text focus-visible:outline-2 focus-visible:outline-accent md:size-8"
                aria-label={`Remover anexo ${index + 1}`}
                onClick={() => remove(item)}
              >
                <X className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
