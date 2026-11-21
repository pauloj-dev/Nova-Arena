'use client';

import { Button, Checkbox, cn, Modal, Progress } from '@nova/ui';
import { AlertTriangle, CheckCircle2, CircleHelp, ImageUp, ScanText } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { LOW_CONFIDENCE, parseBrDrop, parseDuel, type OcrCandidate } from './parse';
import { recognizeImage, type Recognizer } from './recognize';

export type OcrKind = 'drop' | 'duel';
/** O que vai para o formulário: registrationId → campo → número. */
export type OcrValues = Record<string, Partial<Record<'placement' | 'kills' | 'score', number>>>;

interface ReviewRow {
  registrationId: string;
  name: string;
  values: Partial<Record<'placement' | 'kills' | 'score', string>>;
  confidence: number | null;
  source: string | null;
  inferred: boolean;
  use: boolean;
}

const FIELDS: Record<OcrKind, { key: 'placement' | 'kills' | 'score'; label: string }[]> = {
  drop: [
    { key: 'placement', label: 'Colocação' },
    { key: 'kills', label: 'Kills' },
  ],
  duel: [{ key: 'score', label: 'Placar' }],
};

export interface OcrDialogProps {
  open: boolean;
  onClose: () => void;
  kind: OcrKind;
  candidates: OcrCandidate[];
  /** Série melhor de N (duelo), para descartar placar impossível. */
  bestOf?: number;
  onApply: (values: OcrValues) => void;
  /** Troca o reconhecimento (testes). Padrão: Tesseract no navegador. */
  recognize?: Recognizer;
}

type Step = { name: 'pick' } | { name: 'reading'; progress: number; status: string } | { name: 'review' } | { name: 'error'; message: string };

/** Situação de uma linha da revisão: ícone + texto (não só cor). */
function RowStatus({ row }: { row: ReviewRow }) {
  if (row.confidence === null) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted">
        <CircleHelp className="size-3.5 shrink-0" aria-hidden />
        Não encontrado no print
      </span>
    );
  }
  const low = row.confidence < LOW_CONFIDENCE || row.inferred;
  return (
    <span className={cn('flex items-center gap-1 text-xs font-semibold', low ? 'text-warning-soft-text' : 'text-primary-soft-text')}>
      {low ? <AlertTriangle className="size-3.5 shrink-0" aria-hidden /> : <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />}
      {low ? 'Conferir com atenção' : 'Lido do print'}
      <span className="font-normal text-muted">({Math.round(row.confidence * 100)}% de confiança)</span>
    </span>
  );
}

/**
 * "Ler o print" (issue 123, experimental): escolhe a imagem, lê no próprio navegador e mostra o que achou para a
 * pessoa conferir e corrigir. "Usar estes valores" só preenche o formulário — quem salva continua sendo a pessoa.
 */
export function OcrDialog({ open, onClose, kind, candidates, bestOf = 1, onApply, recognize = recognizeImage }: OcrDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [step, setStep] = useState<Step>({ name: 'pick' });
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const inputId = useId();
  const run = useRef(0);

  const previewRef = useRef<string | null>(null);
  // Libera a prévia ao fechar a tela.
  useEffect(() => () => setPreviewUrl(null), []);

  function setPreviewUrl(url: string | null) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = url;
  }

  function choose(picked: File | null) {
    const url = picked && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(picked) : null;
    setPreviewUrl(url);
    setPreview(url);
    setFile(picked);
    setStep({ name: 'pick' });
  }

  function reset() {
    run.current += 1;
    setPreviewUrl(null);
    setFile(null);
    setPreview(null);
    setStep({ name: 'pick' });
    setRows([]);
    setUnmatched([]);
  }

  function close() {
    reset();
    onClose();
  }

  async function read() {
    if (!file) return;
    const id = ++run.current;
    setStep({ name: 'reading', progress: 0, status: 'Preparando o leitor' });
    try {
      const result = await recognize(file, (progress, status) => {
        if (run.current === id) setStep({ name: 'reading', progress: Math.round(progress * 100), status });
      });
      if (run.current !== id) return;
      let next: ReviewRow[];
      if (kind === 'drop') {
        const parsed = parseBrDrop(result, candidates);
        next = candidates.map((c) => {
          const s = parsed.suggestions.find((x) => x.registrationId === c.registrationId);
          return {
            registrationId: c.registrationId,
            name: c.name,
            values: { placement: s?.placement != null ? String(s.placement) : '', kills: s?.kills != null ? String(s.kills) : '' },
            confidence: s ? s.confidence : null,
            source: s?.source ?? null,
            inferred: s?.placementInferred ?? false,
            use: Boolean(s && (s.placement !== null || s.kills !== null)),
          };
        });
        setUnmatched(parsed.unmatched);
      } else {
        const parsed = parseDuel(result, [candidates[0], candidates[1]] as [OcrCandidate, OcrCandidate], bestOf);
        next = candidates.slice(0, 2).map((c) => {
          const s = parsed.find((x) => x.registrationId === c.registrationId);
          const found = s?.score !== null && s?.score !== undefined;
          return { registrationId: c.registrationId, name: c.name, values: { score: found ? String(s.score) : '' }, confidence: found ? (s?.confidence ?? 0) : null, source: s?.source ?? null, inferred: false, use: found };
        });
        setUnmatched([]);
      }
      setRows(next);
      setStep({ name: 'review' });
    } catch {
      if (run.current === id) setStep({ name: 'error', message: 'Não foi possível ler esta imagem. Confira sua conexão (o leitor é baixado na primeira vez) ou digite os valores.' });
    }
  }

  function apply() {
    const values: OcrValues = {};
    for (const row of rows) {
      if (!row.use) continue;
      const out: Partial<Record<'placement' | 'kills' | 'score', number>> = {};
      for (const { key } of FIELDS[kind]) {
        const text = row.values[key]?.trim() ?? '';
        if (/^\d{1,3}$/.test(text)) out[key] = Number(text);
      }
      if (Object.keys(out).length > 0) values[row.registrationId] = out;
    }
    onApply(values);
    close();
  }

  const found = rows.filter((r) => r.use).length;
  const fields = FIELDS[kind];

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && close()}
      size="lg"
      title="Ler o print (experimental)"
      description="A leitura acontece no seu aparelho e só sugere valores. Confira cada um antes de salvar."
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancelar
          </Button>
          {step.name === 'review' ? (
            <Button onClick={apply} disabled={found === 0} iconLeft={<CheckCircle2 className="size-4" aria-hidden />}>
              Usar estes valores
            </Button>
          ) : (
            <Button onClick={() => void read()} disabled={!file || step.name === 'reading'} loading={step.name === 'reading'} iconLeft={<ScanText className="size-4" aria-hidden />}>
              Ler o print
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4" data-testid="ocr-dialog">
        {(step.name === 'pick' || step.name === 'error' || step.name === 'reading') && (
          <div className="flex flex-col gap-3">
            <label htmlFor={inputId} className="flex min-h-11 w-fit cursor-pointer items-center gap-2 rounded-md border border-border-strong bg-surface px-4 text-sm font-semibold text-text hover:bg-surface-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
              <ImageUp className="size-4" aria-hidden />
              {file ? 'Trocar imagem' : 'Escolher imagem do print'}
              <input
                id={inputId}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                disabled={step.name === 'reading'}
                onChange={(e) => choose(e.target.files?.[0] ?? null)}
              />
            </label>
            <p className="text-xs text-muted">Use a tela final da partida, sem cortes, com os nomes e os números legíveis. PNG, JPG ou WebP.</p>
            {file && (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-text">
                  Imagem: <span className="font-semibold break-all">{file.name}</span>
                </p>
                {preview && (
                  // eslint-disable-next-line @next/next/no-img-element -- prévia local (blob:), não passa pelo otimizador
                  <img src={preview} alt="Prévia do print escolhido" className="max-h-56 w-auto max-w-full rounded-md border border-border object-contain" />
                )}
              </div>
            )}
          </div>
        )}

        {step.name === 'reading' && (
          <div role="status" aria-live="polite" className="flex flex-col gap-2">
            <p className="text-sm font-medium text-text">{step.status}…</p>
            <Progress value={step.progress} max={100} label="Andamento da leitura do print" />
          </div>
        )}

        {step.name === 'error' && (
          <p role="alert" className="flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-soft-text">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {step.message}
          </p>
        )}

        {step.name === 'review' && (
          <>
            <p role="status" className="flex items-start gap-2 rounded-md bg-info-soft px-3 py-2 text-sm text-info-soft-text">
              <ScanText className="mt-0.5 size-4 shrink-0" aria-hidden />
              {found === 0
                ? 'Não reconhecemos valores neste print. Tente outra imagem ou digite no formulário.'
                : `Encontramos valores para ${found} de ${rows.length}. Corrija o que estiver errado e desmarque o que não quiser usar.`}
            </p>
            <ul className="flex flex-col gap-2" aria-label="Valores lidos do print" data-testid="ocr-review">
              {rows.map((row) => (
                <li key={row.registrationId} className={cn('flex flex-col gap-2 rounded-lg border p-3', row.use ? 'border-accent' : 'border-border')} data-testid="ocr-row" data-registration={row.registrationId}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-semibold text-text">{row.name}</span>
                    <RowStatus row={row} />
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    {fields.map((field) => (
                      <label key={field.key} className="flex w-24 flex-col gap-1 text-xs font-medium text-muted">
                        {field.label}
                        <input
                          className="tabular min-h-11 rounded-md border border-border-strong bg-surface px-2 text-center text-base text-text"
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          maxLength={3}
                          aria-label={`${field.label} lida de ${row.name}`}
                          value={row.values[field.key] ?? ''}
                          onChange={(e) => setRows((list) => list.map((r) => (r.registrationId === row.registrationId ? { ...r, values: { ...r.values, [field.key]: e.target.value }, use: true } : r)))}
                        />
                      </label>
                    ))}
                    <Checkbox
                      label="Usar"
                      checked={row.use}
                      onCheckedChange={(checked) => setRows((list) => list.map((r) => (r.registrationId === row.registrationId ? { ...r, use: checked } : r)))}
                      className="py-0"
                    />
                  </div>
                  {row.source && <p className="text-xs break-words text-muted">Linha lida: “{row.source}”</p>}
                  {row.inferred && <p className="text-xs text-muted">A colocação veio da ordem das linhas: o print não mostrava o número.</p>}
                </li>
              ))}
            </ul>
            {unmatched.length > 0 && (
              <details className="rounded-md border border-border px-3 py-2 text-sm">
                <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-text">Linhas que não reconhecemos ({unmatched.length})</summary>
                <ul className="list-disc pl-5 text-xs text-muted">
                  {unmatched.map((line) => (
                    <li key={line} className="break-words">
                      {line}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

/** Marca "lido do print" ao lado de um campo preenchido pela leitura (some quando a pessoa altera o valor). */
export function OcrMark({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-1 text-xs font-semibold text-warning-soft-text', className)} data-testid="ocr-mark">
      <ScanText className="size-3.5 shrink-0" aria-hidden />
      lido do print
    </span>
  );
}

export interface OcrConfirmProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Quantos valores vieram do print e ainda não foram alterados. */
  count: number;
  error?: string;
  id?: string;
}

/** Confirmação obrigatória antes de salvar quando há valor lido do print. */
export function OcrConfirm({ checked, onCheckedChange, count, error, id }: OcrConfirmProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <div className="flex flex-col gap-1 rounded-md border border-warning bg-warning-soft px-3 py-1" data-testid="ocr-confirm">
      <Checkbox
        id={fieldId}
        label="Conferi os valores lidos do print"
        hint={`${count === 1 ? '1 valor veio' : `${count} valores vieram`} da leitura automática. Compare com a imagem antes de salvar.`}
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
      {error && (
        <p role="alert" className="flex items-center gap-1 pb-2 text-xs font-medium text-danger">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}

/** Foca a caixa de confirmação (quando a pessoa tenta salvar sem conferir). */
export function focusOcrConfirm(id: string): void {
  document.getElementById(id)?.focus();
}
