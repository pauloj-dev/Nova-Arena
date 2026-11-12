'use client';

import type { Match } from '@nova/schemas';
import { Badge, Button, Modal, Progress, useToast } from '@nova/ui';
import { AlertCircle, CheckCircle2, Download, FileUp } from 'lucide-react';
import { useRef, useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useImportResults } from '@/shared/api/hooks/competition';
import { downloadFile } from '../../lib/download';
import { chunk, importableResults, lobbyMatches, parseResultsCsv, resultsCsvTemplate, type ParsedResults } from './resultsCsv';

const MAX_FILE_BYTES = 2 * 1024 * 1024;

interface Report {
  applied: number;
  /** Erros que a API devolveu, por partida. */
  errors: { label: string; message: string }[];
  /** Quedas que ficaram de fora já na prévia. */
  skipped: number;
}

type Step = { kind: 'pick' } | { kind: 'preview'; fileName: string; parsed: ParsedResults } | { kind: 'sending'; done: number; total: number } | { kind: 'result'; report: Report };

export interface ImportResultsDialogProps {
  tournamentId: string;
  stageName: string;
  /** Partidas da fase (as quedas de sala são as que entram). */
  matches: readonly Match[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Importar resultados de quedas por CSV (issue #48): o arquivo é lido no navegador, a prévia mostra
 * os erros por linha antes de qualquer envio, e o que está certo vai em lotes de até 50 partidas,
 * com barra de progresso e relatório no final.
 */
export function ImportResultsDialog({ tournamentId, stageName, matches, open, onOpenChange }: ImportResultsDialogProps) {
  const [step, setStep] = useState<Step>({ kind: 'pick' });
  const [fileError, setFileError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const importer = useImportResults(tournamentId);
  const { error } = useToast();
  const lobbies = lobbyMatches(matches);

  function close(next: boolean) {
    if (step.kind === 'sending') return;
    if (!next) {
      setStep({ kind: 'pick' });
      setFileError(null);
    }
    onOpenChange(next);
  }

  async function read(file: File | undefined) {
    if (!file) return;
    setFileError(null);
    if (file.size > MAX_FILE_BYTES) {
      setFileError('O arquivo passa de 2 MB. Divida a planilha em arquivos menores.');
      return;
    }
    try {
      const parsed = parseResultsCsv(await file.text(), matches);
      if (parsed.fatal) setFileError(parsed.fatal);
      else setStep({ kind: 'preview', fileName: file.name, parsed });
    } catch {
      setFileError('Não foi possível ler o arquivo. Salve a planilha como CSV e tente de novo.');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function send(parsed: ParsedResults) {
    const ready = importableResults(parsed);
    const labels = new Map(parsed.matches.map((m) => [m.matchId, m.label]));
    const batches = chunk(ready);
    const report: Report = { applied: 0, errors: [], skipped: parsed.matches.length - ready.length };
    setStep({ kind: 'sending', done: 0, total: ready.length });
    let done = 0;
    for (const batch of batches) {
      try {
        const result = await importer.mutateAsync(batch);
        report.applied += result.applied;
        for (const e of result.errors) report.errors.push({ label: labels.get(e.matchId) ?? e.matchId, message: e.message });
      } catch (e) {
        // O lote inteiro falhou (rede, permissão): as quedas dele entram no relatório como não aplicadas.
        const message = errorMessage(e);
        for (const item of batch) report.errors.push({ label: labels.get(item.matchId) ?? item.matchId, message });
        error('Um lote não foi enviado', message);
      }
      done += batch.length;
      setStep({ kind: 'sending', done, total: ready.length });
    }
    setStep({ kind: 'result', report });
  }

  const preview = step.kind === 'preview' ? step.parsed : null;
  const ready = preview ? importableResults(preview) : [];
  const badLines = preview ? preview.lines.filter((l) => l.errors.length > 0) : [];

  return (
    <Modal
      open={open}
      onOpenChange={close}
      size="lg"
      title="Importar resultados por CSV"
      description={`Quedas de "${stageName}". Uma linha por squad e queda: grupo ou sala, queda, squad, colocação e kills.`}
      footer={
        step.kind === 'preview' ? (
          <>
            <Button variant="secondary" onClick={() => setStep({ kind: 'pick' })}>
              Escolher outro arquivo
            </Button>
            <Button disabled={ready.length === 0} onClick={() => void send(step.parsed)}>
              {ready.length === 1 ? 'Importar 1 queda' : `Importar ${ready.length} quedas`}
            </Button>
          </>
        ) : step.kind === 'sending' ? undefined : (
          <Button variant={step.kind === 'result' ? 'primary' : 'secondary'} onClick={() => close(false)}>
            {step.kind === 'result' ? 'Concluir' : 'Fechar'}
          </Button>
        )
      }
    >
      {step.kind === 'pick' && (
        <div className="flex flex-col gap-4">
          <ol className="list-decimal pl-5 text-sm text-text">
            <li>Baixe o modelo desta fase: ele já vem com todos os squads de cada queda que ainda não tem resultado.</li>
            <li>Preencha a colocação e as kills (escreva “ausente” na colocação de quem não jogou). Quedas em branco são ignoradas.</li>
            <li>Escolha o arquivo: mostramos os erros por linha antes de enviar.</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={lobbies.length === 0} iconLeft={<Download className="size-4" aria-hidden />} onClick={() => downloadFile(resultsCsvTemplate(matches), 'modelo-resultados.csv', 'text/csv;charset=utf-8')}>
              Baixar modelo de CSV
            </Button>
            <Button disabled={lobbies.length === 0} iconLeft={<FileUp className="size-4" aria-hidden />} onClick={() => inputRef.current?.click()}>
              Escolher arquivo
            </Button>
            <input ref={inputRef} type="file" accept=".csv,text/csv,text/plain" className="hidden" tabIndex={-1} aria-hidden data-testid="results-csv-input" onChange={(e) => void read(e.target.files?.[0])} />
          </div>
          {lobbies.length === 0 && <p className="text-sm text-muted">Esta fase não tem quedas de Battle Royale: a importação por CSV vale para salas.</p>}
          {fileError && (
            <p role="alert" className="flex items-start gap-1.5 rounded-md bg-danger-soft px-3 py-2 text-sm font-medium text-danger-soft-text">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {fileError}
            </p>
          )}
        </div>
      )}

      {preview && step.kind === 'preview' && (
        <div className="flex flex-col gap-4" data-testid="results-preview">
          <p className="text-sm text-text" role="status">
            <strong>{step.fileName}</strong>: {ready.length} {ready.length === 1 ? 'queda pronta' : 'quedas prontas'} para importar
            {preview.matches.length - ready.length > 0 ? ` e ${preview.matches.length - ready.length} com problema, que ${preview.matches.length - ready.length === 1 ? 'fica' : 'ficam'} de fora.` : '.'}
            {badLines.length > 0 && ` ${badLines.length === 1 ? '1 linha tem erro' : `${badLines.length} linhas têm erro`}.`}
          </p>
          <ul className="flex flex-col gap-2" aria-label="Quedas do arquivo">
            {preview.matches.map((m) => (
              <li key={m.matchId} className="flex flex-col gap-1 rounded-md border border-border p-3 text-sm" data-testid="results-match" data-ready={m.ready}>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-text">{m.label}</span>
                  {m.ready ? (
                    <Badge tone="primary" icon={<CheckCircle2 className="size-3.5" aria-hidden />}>
                      Pronta · {m.entries.length} squads
                    </Badge>
                  ) : (
                    <Badge tone="danger" icon={<AlertCircle className="size-3.5" aria-hidden />}>
                      Fica de fora
                    </Badge>
                  )}
                </span>
                {m.errors.map((message) => (
                  <span key={message} className="font-medium text-danger">
                    {message}
                  </span>
                ))}
              </li>
            ))}
          </ul>
          {badLines.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">Linhas do arquivo com erro</caption>
                <thead className="bg-surface-2 text-left text-muted">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Linha
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Conteúdo
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Erro
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {badLines.map((line) => (
                    <tr key={line.line} className="border-t border-border align-top" data-testid={`results-line-${line.line}`}>
                      <td className="tabular px-3 py-2 text-muted">{line.line}</td>
                      <td className="px-3 py-2 text-text">{[line.values.group, line.values.drop && `queda ${line.values.drop}`, line.values.team, line.values.placement && `col. ${line.values.placement}`, line.values.kills && `${line.values.kills} kills`].filter(Boolean).join(' · ')}</td>
                      <td className="px-3 py-2">
                        <ul className="flex flex-col gap-1 font-medium text-danger">
                          {line.errors.map((message) => (
                            <li key={message} className="flex items-start gap-1">
                              <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                              {message}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {ready.length === 0 && <p className="text-sm text-muted">Nenhuma queda está pronta. Corrija o arquivo e escolha de novo.</p>}
        </div>
      )}

      {step.kind === 'sending' && (
        <div className="flex flex-col gap-3" role="status" aria-live="polite">
          <p className="text-sm text-text">Enviando os resultados em lotes. Não feche esta janela.</p>
          <Progress value={step.done} max={step.total} label="Quedas enviadas" />
        </div>
      )}

      {step.kind === 'result' && (
        <div className="flex flex-col gap-4" data-testid="results-report">
          <dl className="grid gap-3 xs:grid-cols-3">
            {[
              { label: 'Quedas aplicadas', value: step.report.applied },
              { label: 'Recusadas pela API', value: step.report.errors.length },
              { label: 'Fora por erro no arquivo', value: step.report.skipped },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border border-border p-3">
                <dd className="tabular text-2xl font-bold text-text">{item.value}</dd>
                <dt className="text-sm text-muted">{item.label}</dt>
              </div>
            ))}
          </dl>
          {step.report.errors.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-text">Erros por partida</h3>
              <ul className="mt-2 flex flex-col gap-1 text-sm text-text">
                {step.report.errors.map((e, i) => (
                  <li key={`${e.label}-${i}`}>
                    <span className="font-semibold">{e.label}:</span> {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {step.report.applied > 0 && <p className="text-sm text-muted">As tabelas da fase já foram recalculadas.</p>}
        </div>
      )}
    </Modal>
  );
}
