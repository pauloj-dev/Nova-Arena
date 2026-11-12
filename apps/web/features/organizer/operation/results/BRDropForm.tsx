'use client';

import type { Rule } from '@nova/engine';
import type { Match, ResultEntryInput } from '@nova/schemas';
import { Badge, Button, Checkbox, cn, Switch, Textarea } from '@nova/ui';
import { AlertCircle, CheckCircle2, FileUp, ListOrdered, Save, Trophy, UserX } from 'lucide-react';
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  applyDraft,
  fillPlacementsInOrder,
  loadDropDraft,
  parseCount,
  previewPoints,
  rowsFromMatch,
  saveDropDraft,
  sortByPlacement,
  toEntries,
  validateDrop,
  type DropMember,
  type DropRow,
} from './brDrop';
import { EvidenceUpload } from './EvidenceUpload';
import { CELL_INPUT } from './fields';

export interface BRDropSubmit {
  entries: ResultEntryInput[];
  evidenceUrls: string[];
  correctionReason?: string;
}

export interface BRDropFormProps {
  match: Match;
  /** Regras do modelo de pontuação da fase, para a coluna "Pontos (prévia)". */
  rules: Rule[];
  /** Total de quedas da sala (para o multiplicador da última queda). */
  dropCount: number;
  /** A fase lança kills por jogador (RN-03)? */
  killsPerPlayer?: boolean;
  /** Titulares de cada squad: registrationId → jogadores. */
  members?: Record<string, DropMember[]>;
  /** Corrigindo um resultado já validado: o motivo é obrigatório. */
  correction?: boolean;
  submitting?: boolean;
  disabled?: boolean;
  onSubmit: (input: BRDropSubmit) => void;
  onImportCsv?: () => void;
  /** Envio de imagem (troca nos testes). */
  upload?: (file: File) => Promise<string>;
}

type Field = 'placement' | 'kills';

/**
 * Lançamento de uma queda de Battle Royale (PRD §15.6, US-ORG-07). Uma linha por squad da sala,
 * com Colocação e Kills; Tab e Enter andam célula a célula, as setas sobem e descem; a coluna
 * "Pontos (prévia)" é calculada pelo motor com o modelo da fase. No celular cada squad vira um cartão.
 */
export function BRDropForm({ match, rules, dropCount, killsPerPlayer = false, members = {}, correction = false, submitting = false, disabled = false, onSubmit, onImportCsv, upload }: BRDropFormProps) {
  const [rows, setRows] = useState<DropRow[]>(() => (correction ? rowsFromMatch(match) : applyDraft(rowsFromMatch(match), loadDropDraft(match.id))));
  const [restored] = useState(() => !correction && loadDropDraft(match.id) !== null);
  const [autoSort, setAutoSort] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>(() => (correction ? match.evidenceUrls : []));
  const [uploading, setUploading] = useState(false);
  const [reason, setReason] = useState('');
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const dropIndex = match.dropIndex ?? match.round;
  const ctx = useMemo(() => ({ rules, dropIndex, dropCount, multiplier: match.multiplier }), [rules, dropIndex, dropCount, match.multiplier]);
  const validation = useMemo(() => validateDrop(rows, { killsPerPlayer, members }), [rows, killsPerPlayer, members]);
  const absentCount = rows.filter((r) => r.absent).length;
  const errorCount = Object.keys(validation.errors).length;
  const reasonMissing = correction && reason.trim().length < 3;

  function update(registrationId: string, change: Partial<DropRow>) {
    setRows((list) => list.map((row) => (row.registrationId === registrationId ? { ...row, ...change } : row)));
    setDraftNote(null);
  }

  /** Erro de um campo: os de regra aparecem na hora; "em branco" só depois de tentar enviar. */
  function fieldError(row: DropRow, field: Field): string | undefined {
    const live = validation.errors[row.registrationId]?.[field];
    if (live) return live;
    if (attempted && !row.absent && parseCount(row[field]) === null) return field === 'placement' ? 'Informe a colocação' : 'Informe as kills';
    return undefined;
  }

  function cells(): HTMLInputElement[] {
    return [...(gridRef.current?.querySelectorAll<HTMLInputElement>('input[data-cell]:not(:disabled)') ?? [])];
  }

  /** Enter avança uma célula (na última, vai para "Validar queda"); as setas sobem e descem na mesma coluna. Tab é o do navegador. */
  function onCellKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const all = cells();
    const index = all.indexOf(event.currentTarget);
    if (index < 0) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      if ((event.ctrlKey || event.metaKey) && !disabled) {
        submit();
        return;
      }
      const next = all[event.shiftKey ? index - 1 : index + 1];
      if (next) {
        next.focus();
        next.select();
      } else if (!event.shiftKey) event.currentTarget.form?.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const column = event.currentTarget.dataset.cell;
      const sameColumn = all.filter((input) => input.dataset.cell === column);
      const target = sameColumn[sameColumn.indexOf(event.currentTarget) + (event.key === 'ArrowDown' ? 1 : -1)];
      if (target) {
        event.preventDefault();
        target.focus();
        target.select();
      }
    }
  }

  /** Primeiro campo com erro ou em branco, na ordem da tela (calculado do estado, sem esperar a tela redesenhar). */
  function firstProblemField(): HTMLInputElement | null {
    const rowElements = [...(gridRef.current?.querySelectorAll<HTMLElement>('[data-testid="drop-row"]') ?? [])];
    for (const row of rows) {
      if (row.absent) continue;
      const element = rowElements.find((el) => el.dataset.registration === row.registrationId);
      const errors = validation.errors[row.registrationId];
      if (errors?.placement || parseCount(row.placement) === null) return element?.querySelector<HTMLInputElement>('input[data-cell="placement"]') ?? null;
      if (errors?.kills || parseCount(row.kills) === null) return element?.querySelector<HTMLInputElement>('input[data-cell="kills"]') ?? null;
      if (errors?.playerKills) return element?.querySelector<HTMLInputElement>('fieldset input') ?? null;
    }
    return null;
  }

  function submit() {
    setAttempted(true);
    if (!validation.valid || reasonMissing || uploading) {
      // Leva o foco ao primeiro campo com problema — na hora, e não um quadro depois: se a pessoa já
      // estiver indo para outro campo, o foco não pode ser tirado dela no meio da digitação.
      firstProblemField()?.focus();
      return;
    }
    onSubmit({ entries: toEntries(rows, { killsPerPlayer, members }), evidenceUrls, ...(correction ? { correctionReason: reason.trim() } : {}) });
  }

  function saveDraft() {
    const ok = saveDropDraft(match.id, rows);
    setDraftNote(ok ? 'Rascunho salvo neste aparelho. Ele continua aqui se você recarregar a página.' : 'Não foi possível salvar o rascunho neste navegador.');
  }

  const title = [match.stageName, match.groupName, `Queda ${dropIndex} de ${dropCount}`].filter(Boolean).join(' · ');

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      aria-label={`Lançamento: ${title}`}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-lg break-words" data-testid="drop-title">
            {title}
          </h3>
          <p className="text-sm text-muted">
            {rows.length} {rows.length === 1 ? 'squad' : 'squads'} na sala
            {match.multiplier > 1 && <> · esta queda vale ×{match.multiplier.toLocaleString('pt-BR')}</>}
            {correction && <> · corrigindo um resultado já validado</>}
          </p>
        </div>
        {onImportCsv && (
          <Button type="button" variant="secondary" size="sm" iconLeft={<FileUp className="size-4" aria-hidden />} onClick={onImportCsv}>
            Importar CSV
          </Button>
        )}
      </div>

      {restored && (
        <p role="status" className="rounded-md bg-info-soft px-3 py-2 text-sm text-info-soft-text">
          Recuperamos o rascunho que você salvou para esta queda.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Button type="button" variant="secondary" size="sm" disabled={disabled} iconLeft={<ListOrdered className="size-4" aria-hidden />} onClick={() => setRows((list) => fillPlacementsInOrder(list))}>
          Preencher colocações na ordem
        </Button>
        <Switch
          label="Ordenar pela colocação"
          checked={autoSort}
          onCheckedChange={(checked) => {
            setAutoSort(checked);
            if (checked) setRows((list) => sortByPlacement(list));
          }}
          className="gap-3"
        />
      </div>

      <div ref={gridRef} role="table" aria-label={`Resultado da ${title}`} className="flex flex-col gap-2 md:gap-0 md:rounded-lg md:border md:border-border">
        <div role="row" className="hidden grid-cols-[minmax(0,1fr)_7rem_7rem_7rem] items-center gap-3 bg-surface-2 px-3 py-2 text-xs font-semibold text-muted md:grid md:rounded-t-lg">
          <span role="columnheader">Squad</span>
          <span role="columnheader" className="text-center">
            Colocação
          </span>
          <span role="columnheader" className="text-center">
            Kills
          </span>
          <span role="columnheader" className="text-right">
            Pontos (prévia)
          </span>
        </div>
        {rows.map((row, index) => {
          const placementError = fieldError(row, 'placement');
          const killsError = fieldError(row, 'kills');
          const playersError = validation.errors[row.registrationId]?.playerKills;
          const points = previewPoints(row, ctx, rows.length);
          const first = !row.absent && parseCount(row.placement) === 1;
          const squad = killsPerPlayer ? (members[row.registrationId] ?? []) : [];
          const errorId = `erro-${row.registrationId}`;
          const messages = [placementError, killsError, playersError].filter((m): m is string => Boolean(m));
          return (
            <div
              key={row.registrationId}
              role="row"
              data-testid="drop-row"
              data-registration={row.registrationId}
              className={cn('grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg border border-border bg-surface p-3 md:grid-cols-[minmax(0,1fr)_7rem_7rem_7rem] md:items-center md:rounded-none md:border-0 md:border-t md:px-3 md:py-2', row.absent && 'bg-surface-2')}
            >
              <div role="cell" className="col-span-2 flex min-w-0 items-center gap-2 md:col-span-1">
                <span className="tabular flex size-6 shrink-0 items-center justify-center text-xs text-muted" aria-hidden>
                  {first ? <Trophy className="size-4 text-gold-soft-text" /> : index + 1}
                </span>
                <span className="min-w-0 truncate text-sm font-semibold text-text">
                  {row.name}
                  {row.tag && <span className="tabular ml-1 text-xs font-normal text-muted">[{row.tag}]</span>}
                </span>
                {first && <span className="sr-only">Booyah</span>}
                {row.absent && (
                  <Badge tone="neutral" icon={<UserX className="size-3.5" aria-hidden />}>
                    Ausente
                  </Badge>
                )}
              </div>
              <label role="cell" className="flex flex-col gap-1 text-xs font-medium text-muted">
                <span className="md:sr-only" aria-hidden>
                  Colocação
                </span>
                <input
                  data-cell="placement"
                  aria-label={`Colocação de ${row.name}`}
                  // Abre já na primeira célula: dá para lançar a queda inteira sem tirar a mão do teclado.
                  autoFocus={index === 0 && !correction}
                  className={CELL_INPUT}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  enterKeyHint="next"
                  maxLength={3}
                  value={row.absent ? '' : row.placement}
                  disabled={row.absent || disabled}
                  aria-invalid={placementError ? true : undefined}
                  aria-describedby={messages.length > 0 ? errorId : undefined}
                  onChange={(e) => update(row.registrationId, { placement: e.target.value })}
                  onBlur={() => autoSort && setRows((list) => sortByPlacement(list))}
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={onCellKeyDown}
                />
              </label>
              <label role="cell" className="flex flex-col gap-1 text-xs font-medium text-muted">
                <span className="md:sr-only" aria-hidden>
                  Kills
                </span>
                <input
                  data-cell="kills"
                  aria-label={`Kills de ${row.name}`}
                  className={CELL_INPUT}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  enterKeyHint="next"
                  maxLength={4}
                  value={row.absent ? '' : row.kills}
                  disabled={row.absent || disabled}
                  aria-invalid={killsError ? true : undefined}
                  aria-describedby={messages.length > 0 ? errorId : undefined}
                  onChange={(e) => update(row.registrationId, { kills: e.target.value })}
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={onCellKeyDown}
                />
              </label>
              <div role="cell" className="col-span-2 flex items-baseline justify-between gap-2 text-sm md:col-span-1 md:justify-end" data-testid="drop-points">
                <span className="text-xs text-muted md:sr-only">Pontos (prévia)</span>
                <span className="tabular text-base font-bold text-text">{points === null ? <span className="font-normal text-muted">—</span> : points.toLocaleString('pt-BR')}</span>
              </div>
              {squad.length > 0 && !row.absent && (
                <fieldset className="col-span-2 flex flex-wrap items-end gap-2 md:col-span-4">
                  <legend className="mb-1 text-xs text-muted">Kills por jogador de {row.name}</legend>
                  {squad.map((member) => (
                    <label key={member.userId} className="flex w-20 flex-col gap-1 text-xs text-muted">
                      <span className="truncate">{member.nickname}</span>
                      <input
                        className={cn(CELL_INPUT, 'min-h-11 md:min-h-9')}
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        autoComplete="off"
                        maxLength={3}
                        aria-label={`Kills de ${member.nickname} (${row.name})`}
                        aria-invalid={playersError ? true : undefined}
                        aria-describedby={playersError ? errorId : undefined}
                        disabled={disabled}
                        value={row.playerKills[member.userId] ?? ''}
                        onChange={(e) => update(row.registrationId, { playerKills: { ...row.playerKills, [member.userId]: e.target.value } })}
                        onFocus={(e) => e.currentTarget.select()}
                      />
                    </label>
                  ))}
                </fieldset>
              )}
              {messages.length > 0 && (
                <ul id={errorId} className="col-span-2 flex flex-col gap-0.5 text-xs font-medium text-danger md:col-span-4" data-testid="drop-row-error">
                  {messages.map((message) => (
                    <li key={message} className="flex items-start gap-1">
                      <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      {message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <details className="rounded-lg border border-border bg-surface px-3 py-2">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-text">
          Marcar squad ausente{absentCount > 0 ? ` (${absentCount})` : ''}
        </summary>
        <p className="text-xs text-muted">Squad ausente não recebe colocação nem pontos nesta queda.</p>
        <div className="grid grid-cols-1 gap-x-4 xs:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => (
            <Checkbox key={row.registrationId} label={`${row.name} ausente`} checked={row.absent} disabled={disabled} onCheckedChange={(checked) => update(row.registrationId, { absent: checked })} />
          ))}
        </div>
      </details>

      <EvidenceUpload value={evidenceUrls} onChange={setEvidenceUrls} onBusyChange={setUploading} disabled={disabled} upload={upload} />

      {correction && (
        <Textarea
          label="Motivo da correção"
          required
          rows={2}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          hint="Fica registrado no histórico da partida e na auditoria."
          error={attempted && reasonMissing ? 'Informe o motivo da correção' : undefined}
        />
      )}

      <p role="status" aria-live="polite" className={cn('flex items-center gap-1.5 text-sm', errorCount > 0 ? 'font-medium text-danger' : 'text-muted')} data-testid="drop-status">
        {errorCount > 0 ? (
          <>
            <AlertCircle className="size-4 shrink-0" aria-hidden />
            {errorCount === 1 ? 'Corrija o squad destacado antes de validar.' : `Corrija os ${errorCount} squads destacados antes de validar.`}
          </>
        ) : validation.missing > 0 ? (
          `${validation.missing === 1 ? 'Falta 1 campo' : `Faltam ${validation.missing} campos`} para validar a queda.`
        ) : (
          <>
            <CheckCircle2 className="size-4 shrink-0 text-primary-soft-text" aria-hidden />
            Tudo preenchido. Os pontos oficiais são calculados pelo servidor ao validar.
          </>
        )}
      </p>
      {draftNote && (
        <p role="status" className="text-sm text-muted">
          {draftNote}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
        {!correction && (
          <Button type="button" variant="secondary" disabled={disabled} iconLeft={<Save className="size-4" aria-hidden />} onClick={saveDraft}>
            Salvar rascunho
          </Button>
        )}
        <Button type="submit" loading={submitting} disabled={disabled || uploading} iconLeft={<CheckCircle2 className="size-4" aria-hidden />}>
          {correction ? 'Salvar correção' : 'Validar queda'}
        </Button>
      </div>
    </form>
  );
}
