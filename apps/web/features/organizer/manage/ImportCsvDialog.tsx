'use client';

import type { ImportRegistrationsResult, ModeSize } from '@nova/schemas';
import { Badge, Button, Modal, useToast } from '@nova/ui';
import { AlertCircle, CheckCircle2, Download, FileUp } from 'lucide-react';
import { useRef, useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useImportRegistrations } from '@/shared/api/hooks/organizer';
import { useT } from '@/shared/i18n/react';
import { importableRows, parseRegistrationsCsv, registrationsCsvTemplate, type ParsedImport } from '../lib/csv';
import { downloadFile } from '../lib/download';
import { messages } from './guests/messages';

interface ImportCsvDialogProps {
  tournamentId: string;
  isTeam: boolean;
  /** Titulares e reservas do modo (campeonato por squad): a planilha ganha as colunas do elenco (RN-18). */
  roster?: ModeSize | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MAX_FILE_BYTES = 2 * 1024 * 1024;

type Step = { kind: 'pick' } | { kind: 'preview'; fileName: string; parsed: ParsedImport } | { kind: 'result'; result: ImportRegistrationsResult; fileLines: number[] };

/** Importar inscritos de uma planilha (issue #30): o arquivo é lido no navegador e a prévia mostra os erros por linha antes de enviar. */
export function ImportCsvDialog({ tournamentId, isTeam, roster = null, open, onOpenChange }: ImportCsvDialogProps) {
  const t = useT(messages, 'ImportCsvDialog');
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
      setFileError(t('arquivoGrande'));
      return;
    }
    try {
      const parsed = parseRegistrationsCsv(await file.text(), isTeam ? roster : null);
      if (parsed.fatal) setFileError(parsed.fatal);
      else setStep({ kind: 'preview', fileName: file.name, parsed });
    } catch {
      setFileError(t('erroLer'));
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const ready = step.kind === 'preview' ? importableRows(step.parsed) : { rows: [], fileLines: [] };
  const withErrors = step.kind === 'preview' ? step.parsed.lines.filter((l) => l.errors.length > 0) : [];

  // A coluna do elenco só aparece na prévia quando a planilha trouxe algum jogador.
  const withRoster = step.kind === 'preview' && step.parsed.lines.some((l) => l.members.length > 0);

  const previewSummary =
    step.kind === 'preview' ? t.rich('previa', { arquivo: step.fileName, prontas: ready.rows.length, comErro: withErrors.length, strong: (chunks) => <strong>{chunks}</strong> }) : null;

  return (
    <Modal
      open={open}
      onOpenChange={close}
      size="lg"
      title={t('titulo')}
      description={t('descricao')}
      footer={
        step.kind === 'preview' ? (
          <>
            <Button variant="secondary" onClick={() => setStep({ kind: 'pick' })}>
              {t('outroArquivo')}
            </Button>
            <Button
              loading={importer.isPending}
              disabled={ready.rows.length === 0}
              onClick={() =>
                importer.mutate(
                  { rows: ready.rows },
                  {
                    onSuccess: (result) => setStep({ kind: 'result', result, fileLines: ready.fileLines }),
                    onError: (e) => error(t('erroImportar'), errorMessage(e)),
                  },
                )
              }
            >
              {t('importar', { count: ready.rows.length })}
            </Button>
          </>
        ) : (
          <Button variant={step.kind === 'result' ? 'primary' : 'secondary'} onClick={() => close(false)}>
            {step.kind === 'result' ? t('concluir') : t('fechar')}
          </Button>
        )
      }
    >
      {step.kind === 'pick' && (
        <div className="flex flex-col gap-4">
          <ol className="list-decimal pl-5 text-sm text-text">
            <li>{t('passo1', { tipo: isTeam ? 'squad' : 'jogador' })}</li>
            <li>{t('passo2')}</li>
            <li>{t('passo3')}</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" iconLeft={<Download className="size-4" aria-hidden />} onClick={() => downloadFile(registrationsCsvTemplate(isTeam, roster), t('arquivoModelo'), 'text/csv;charset=utf-8')}>
              {t('baixarModelo')}
            </Button>
            <Button iconLeft={<FileUp className="size-4" aria-hidden />} onClick={() => inputRef.current?.click()}>
              {t('escolherArquivo')}
            </Button>
            <input ref={inputRef} type="file" accept=".csv,text/csv,text/plain" className="hidden" tabIndex={-1} aria-hidden data-testid="csv-input" onChange={(e) => void read(e.target.files?.[0])} />
          </div>
          {fileError && (
            <p role="alert" className="flex items-start gap-1.5 rounded-md bg-danger-soft px-3 py-2 text-sm font-medium text-danger-soft-text">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {fileError}
            </p>
          )}
          <p className="text-xs text-muted">{t('colunas')}</p>
          {isTeam && roster && <p className="text-xs text-muted">{t('colunasElenco', { titulares: roster.teamSize, reservas: roster.maxSubs })}</p>}
        </div>
      )}

      {step.kind === 'preview' && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text" role="status">
            {previewSummary}
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">{t('previaLegenda')}</caption>
              <thead className="bg-surface-2 text-left text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {t('linha')}
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {t('nome')}
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {t('tag')}
                  </th>
                  {withRoster && (
                    <th scope="col" className="px-3 py-2 font-semibold">
                      {t('jogadores')}
                    </th>
                  )}
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {t('situacao')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {step.parsed.lines.map((line) => (
                  <tr key={line.line} className="border-t border-border align-top" data-testid={`csv-line-${line.line}`}>
                    <td className="tabular px-3 py-2 text-muted">{line.line}</td>
                    <td className="px-3 py-2 text-text">{line.values.name || <span className="text-muted">{t('vazio')}</span>}</td>
                    <td className="px-3 py-2 text-text">{line.values.tag}</td>
                    {withRoster && <td className="px-3 py-2 text-text">{line.members.map((m) => (m.isSub ? t('jogadorReserva', { nome: m.name }) : m.name)).join(', ')}</td>}
                    <td className="px-3 py-2">
                      {line.errors.length === 0 ? (
                        <Badge tone="primary" icon={<CheckCircle2 className="size-3.5" aria-hidden />}>
                          {t('pronta')}
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
          {ready.rows.length === 0 && <p className="text-sm text-muted">{t('nenhumaPronta')}</p>}
        </div>
      )}

      {step.kind === 'result' && (
        <div className="flex flex-col gap-4" data-testid="import-result">
          <dl className="grid gap-3 xs:grid-cols-3">
            {[
              { label: t('criados'), value: step.result.created },
              { label: t('naEspera'), value: step.result.waitlisted },
              { label: t('puladas'), value: step.result.skipped.length },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border border-border p-3">
                <dd className="tabular text-2xl font-bold text-text">{item.value}</dd>
                <dt className="text-sm text-muted">{item.label}</dt>
              </div>
            ))}
          </dl>
          {step.result.skipped.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-text">{t('porQue')}</h3>
              <ul className="mt-2 flex flex-col gap-1 text-sm text-text">
                {step.result.skipped.map((skip) => (
                  <li key={skip.row}>
                    <span className="tabular text-muted">{t('linhaN', { linha: step.fileLines[skip.row - 1] ?? skip.row })}</span> {skip.reason}
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
