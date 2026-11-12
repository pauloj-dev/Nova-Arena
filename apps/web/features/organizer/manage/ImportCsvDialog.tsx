'use client';

import type { ImportRegistrationsResult } from '@nova/schemas';
import { Badge, Button, Modal, useToast } from '@nova/ui';
import { AlertCircle, CheckCircle2, Download, FileUp } from 'lucide-react';
import { useRef, useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useImportRegistrations } from '@/shared/api/hooks/organizer';
import { importableRows, parseRegistrationsCsv, registrationsCsvTemplate, type ParsedImport } from '../lib/csv';
import { downloadFile } from '../lib/download';

interface ImportCsvDialogProps {
  tournamentId: string;
  isTeam: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MAX_FILE_BYTES = 2 * 1024 * 1024;

type Step = { kind: 'pick' } | { kind: 'preview'; fileName: string; parsed: ParsedImport } | { kind: 'result'; result: ImportRegistrationsResult; fileLines: number[] };

/** Importar inscritos de uma planilha (issue #30): o arquivo é lido no navegador e a prévia mostra os erros por linha antes de enviar. */
export function ImportCsvDialog({ tournamentId, isTeam, open, onOpenChange }: ImportCsvDialogProps) {
  const [step, setStep] = useState<Step>({ kind: 'pick' });
  const [fileError, setFileError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const importer = useImportRegistrations(tournamentId);
  const { error } = useToast();

  function close(next: boolean) {
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
      const parsed = parseRegistrationsCsv(await file.text());
      if (parsed.fatal) setFileError(parsed.fatal);
      else setStep({ kind: 'preview', fileName: file.name, parsed });
    } catch {
      setFileError('Não foi possível ler o arquivo. Salve a planilha como CSV e tente de novo.');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const ready = step.kind === 'preview' ? importableRows(step.parsed) : { rows: [], fileLines: [] };
  const withErrors = step.kind === 'preview' ? step.parsed.lines.filter((l) => l.errors.length > 0) : [];

  return (
    <Modal
      open={open}
      onOpenChange={close}
      size="lg"
      title="Importar inscritos por CSV"
      description="Para trazer inscritos que vieram de formulário ou planilha. Eles entram sem conta na plataforma, só com nome e tag."
      footer={
        step.kind === 'preview' ? (
          <>
            <Button variant="secondary" onClick={() => setStep({ kind: 'pick' })}>
              Escolher outro arquivo
            </Button>
            <Button
              loading={importer.isPending}
              disabled={ready.rows.length === 0}
              onClick={() =>
                importer.mutate(
                  { rows: ready.rows },
                  {
                    onSuccess: (result) => setStep({ kind: 'result', result, fileLines: ready.fileLines }),
                    onError: (e) => error('Não foi possível importar', errorMessage(e)),
                  },
                )
              }
            >
              {ready.rows.length === 1 ? 'Importar 1 inscrito' : `Importar ${ready.rows.length} inscritos`}
            </Button>
          </>
        ) : (
          <Button variant={step.kind === 'result' ? 'primary' : 'secondary'} onClick={() => close(false)}>
            {step.kind === 'result' ? 'Concluir' : 'Fechar'}
          </Button>
        )
      }
    >
      {step.kind === 'pick' && (
        <div className="flex flex-col gap-4">
          <ol className="list-decimal pl-5 text-sm text-text">
            <li>Baixe o modelo e preencha uma linha por {isTeam ? 'squad' : 'jogador'}.</li>
            <li>Salve como CSV (o Excel em português já usa ponto e vírgula).</li>
            <li>Escolha o arquivo: mostramos uma prévia antes de importar.</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" iconLeft={<Download className="size-4" aria-hidden />} onClick={() => downloadFile(registrationsCsvTemplate(isTeam), 'modelo-inscritos.csv', 'text/csv;charset=utf-8')}>
              Baixar modelo de CSV
            </Button>
            <Button iconLeft={<FileUp className="size-4" aria-hidden />} onClick={() => inputRef.current?.click()}>
              Escolher arquivo
            </Button>
            <input ref={inputRef} type="file" accept=".csv,text/csv,text/plain" className="hidden" tabIndex={-1} aria-hidden data-testid="csv-input" onChange={(e) => void read(e.target.files?.[0])} />
          </div>
          {fileError && (
            <p role="alert" className="flex items-start gap-1.5 rounded-md bg-danger-soft px-3 py-2 text-sm font-medium text-danger-soft-text">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {fileError}
            </p>
          )}
          <p className="text-xs text-muted">Colunas: nome (obrigatória), tag (até 5 letras), contato e id_no_jogo. Quem passar das vagas entra na lista de espera, na ordem do arquivo.</p>
        </div>
      )}

      {step.kind === 'preview' && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text" role="status">
            <strong>{step.fileName}</strong>: {ready.rows.length} {ready.rows.length === 1 ? 'linha pronta' : 'linhas prontas'} para importar
            {withErrors.length > 0 ? ` e ${withErrors.length} com erro, que ${withErrors.length === 1 ? 'fica' : 'ficam'} de fora.` : '.'}
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Prévia das linhas do arquivo</caption>
              <thead className="bg-surface-2 text-left text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Linha
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Nome
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Tag
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Situação
                  </th>
                </tr>
              </thead>
              <tbody>
                {step.parsed.lines.map((line) => (
                  <tr key={line.line} className="border-t border-border align-top" data-testid={`csv-line-${line.line}`}>
                    <td className="tabular px-3 py-2 text-muted">{line.line}</td>
                    <td className="px-3 py-2 text-text">{line.values.name || <span className="text-muted">(vazio)</span>}</td>
                    <td className="px-3 py-2 text-text">{line.values.tag}</td>
                    <td className="px-3 py-2">
                      {line.errors.length === 0 ? (
                        <Badge tone="primary" icon={<CheckCircle2 className="size-3.5" aria-hidden />}>
                          Pronta
                        </Badge>
                      ) : (
                        <ul className="flex flex-col gap-1 text-danger">
                          {line.errors.map((message) => (
                            <li key={message} className="flex items-start gap-1 font-medium">
                              <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                              {message}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {ready.rows.length === 0 && <p className="text-sm text-muted">Nenhuma linha está pronta. Corrija o arquivo e escolha de novo.</p>}
        </div>
      )}

      {step.kind === 'result' && (
        <div className="flex flex-col gap-4" data-testid="import-result">
          <dl className="grid gap-3 xs:grid-cols-3">
            {[
              { label: 'Inscritos criados', value: step.result.created },
              { label: 'Na lista de espera', value: step.result.waitlisted },
              { label: 'Linhas puladas', value: step.result.skipped.length },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border border-border p-3">
                <dd className="tabular text-2xl font-bold text-text">{item.value}</dd>
                <dt className="text-sm text-muted">{item.label}</dt>
              </div>
            ))}
          </dl>
          {step.result.skipped.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-text">Por que foram puladas</h3>
              <ul className="mt-2 flex flex-col gap-1 text-sm text-text">
                {step.result.skipped.map((skip) => (
                  <li key={skip.row}>
                    <span className="tabular text-muted">Linha {step.fileLines[skip.row - 1] ?? skip.row}:</span> {skip.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
