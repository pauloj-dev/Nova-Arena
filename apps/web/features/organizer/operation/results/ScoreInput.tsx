'use client';

import type { ExtraStatField, Match, ResultEntryInput } from '@nova/schemas';
import { Button, cn, Textarea } from '@nova/ui';
import { AlertCircle, CheckCircle2, Trophy } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { duelFromMatch, duelPayload, scoreLabel, validateDuel, winsNeeded, type DuelState } from './duel';
import { EvidenceUpload } from './EvidenceUpload';
import { CELL_INPUT } from './fields';

export interface ScoreSubmit {
  entries: ResultEntryInput[];
  winnerRegistrationId?: string | null;
  evidenceUrls: string[];
  correctionReason?: string;
}

export interface ScoreInputProps {
  match: Match;
  /** Slug do jogo, para o rótulo do placar (coroas, gols, frames). */
  gameSlug?: string;
  /** Estatísticas extras do jogo (`game.extraStatFields`). */
  extraStatFields?: ExtraStatField[];
  correction?: boolean;
  submitting?: boolean;
  disabled?: boolean;
  onSubmit: (input: ScoreSubmit) => void;
  upload?: (file: File) => Promise<string>;
}

/**
 * Lançamento de duelo: placar dos dois lados (em série MD, jogos vencidos), estatísticas extras do
 * jogo, desempate só quando o placar empata em partida eliminatória (RN-14) e escolha explícita do
 * vencedor quando ainda sobra empate. Manda só estatísticas brutas: os pontos vêm do servidor.
 */
export function ScoreInput({ match, gameSlug, extraStatFields = [], correction = false, submitting = false, disabled = false, onSubmit, upload }: ScoreInputProps) {
  const [state, setState] = useState<DuelState | null>(() => duelFromMatch(match));
  const [attempted, setAttempted] = useState(false);
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>(() => (correction ? match.evidenceUrls : []));
  const [uploading, setUploading] = useState(false);
  const [reason, setReason] = useState('');
  const groupId = useId();

  const ctx = useMemo(() => ({ bestOf: match.bestOf, elimination: match.bracket !== null, extraStatFields }), [match.bestOf, match.bracket, extraStatFields]);
  const validation = useMemo(() => (state ? validateDuel(state, ctx) : null), [state, ctx]);

  if (!state || !validation) {
    return <p className="text-sm text-muted">Esta partida ainda espera o resultado de partidas anteriores: os dois lados precisam estar definidos para lançar o placar.</p>;
  }

  const label = scoreLabel(gameSlug, match.bestOf);
  const needed = winsNeeded(match.bestOf);
  const reasonMissing = correction && reason.trim().length < 3;
  const always = extraStatFields.filter((f) => f.when === 'always');
  const tiebreak = validation.showTiebreak ? extraStatFields.filter((f) => f.when === 'tiebreak') : [];
  const winnerName = state.sides.find((s) => s.registrationId === validation.winnerId)?.name;

  function setSide(registrationId: string, change: { score?: string; stat?: [string, string] }) {
    setState((current) => {
      if (!current) return current;
      const sides = current.sides.map((side) => {
        if (side.registrationId !== registrationId) return side;
        return { ...side, ...(change.score !== undefined ? { score: change.score } : {}), ...(change.stat ? { stats: { ...side.stats, [change.stat[0]]: change.stat[1] } } : {}) };
      }) as DuelState['sides'];
      return { ...current, sides };
    });
  }

  function submit() {
    setAttempted(true);
    if (!state || !validation || !validation.valid || reasonMissing || uploading) return;
    onSubmit({ ...duelPayload(state, ctx, validation), evidenceUrls, ...(correction ? { correctionReason: reason.trim() } : {}) });
  }

  const statFields = (fields: ExtraStatField[], legend: string) =>
    fields.map((field) => (
      <fieldset key={field.key} className="flex flex-col gap-2" data-testid={`stat-${field.key}`}>
        <legend className="text-sm font-medium text-text">
          {field.label}
          <span className="font-normal text-muted"> · {legend}</span>
        </legend>
        <div className="grid grid-cols-2 gap-3">
          {state.sides.map((side) => {
            const error = validation.errors.stats[`${side.registrationId}:${field.key}`] ?? (attempted && field.when === 'tiebreak' && (side.stats[field.key] ?? '').trim() === '' ? 'Informe o valor' : undefined);
            return (
              <label key={side.registrationId} className="flex flex-col gap-1 text-xs text-muted">
                <span className="truncate">{side.name}</span>
                <input
                  aria-label={`${field.label} de ${side.name}`}
                  className={CELL_INPUT}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  maxLength={3}
                  disabled={disabled}
                  aria-invalid={error ? true : undefined}
                  value={side.stats[field.key] ?? ''}
                  onChange={(e) => setSide(side.registrationId, { stat: [field.key, e.target.value] })}
                />
                {error && <span className="font-medium text-danger">{error}</span>}
              </label>
            );
          })}
        </div>
      </fieldset>
    ));

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      aria-label={`Lançamento: ${match.roundLabel}, ${state.sides[0].name} x ${state.sides[1].name}`}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div>
        <h3 className="text-lg break-words">
          {[match.stageName, match.groupName, match.roundLabel].filter(Boolean).join(' · ')}
        </h3>
        <p className="text-sm text-muted">
          {match.bestOf > 1 ? `Série MD${match.bestOf}: vence quem fizer ${needed} ${needed === 1 ? 'jogo' : 'jogos'}. Lance os jogos vencidos por cada lado.` : `Jogo único. Lance ${label.toLowerCase()} de cada lado.`}
          {correction && ' Você está corrigindo um resultado já validado.'}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {state.sides.map((side) => {
          const error = validation.errors.scores[side.registrationId] ?? (attempted && side.score.trim() === '' ? 'Informe o placar' : undefined);
          const winning = validation.winnerId === side.registrationId;
          return (
            <label key={side.registrationId} className={cn('flex min-w-0 flex-col gap-1.5 rounded-lg border border-border bg-surface p-3', winning && 'border-accent')} data-testid="score-side">
              <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-text">
                <span className="truncate">{side.name}</span>
                {winning && <Trophy className="size-4 shrink-0 text-gold-soft-text" aria-hidden />}
              </span>
              <span className="text-xs text-muted">{label}</span>
              <input
                aria-label={`${label} de ${side.name}`}
                className={cn(CELL_INPUT, 'text-xl font-bold')}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                maxLength={3}
                disabled={disabled}
                aria-invalid={error ? true : undefined}
                value={side.score}
                onChange={(e) => setSide(side.registrationId, { score: e.target.value })}
                onFocus={(e) => e.currentTarget.select()}
              />
              {error && (
                <span className="flex items-center gap-1 text-xs font-medium text-danger">
                  <AlertCircle className="size-3.5 shrink-0" aria-hidden />
                  {error}
                </span>
              )}
            </label>
          );
        })}
      </div>

      {validation.errors.form && (
        <p role="alert" className="flex items-start gap-1.5 rounded-md bg-danger-soft px-3 py-2 text-sm font-medium text-danger-soft-text">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {validation.errors.form}
        </p>
      )}

      {statFields(always, 'estatística do jogo')}
      {statFields(tiebreak, 'desempate: o placar ficou empatado')}

      {validation.needsWinner && (
        <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3" data-testid="winner-choice">
          <legend className="px-1 text-sm font-medium text-text">O placar ficou empatado. Quem venceu o desempate?</legend>
          {state.sides.map((side) => (
            <label key={side.registrationId} className="flex min-h-11 items-center gap-3 text-sm text-text">
              <input
                type="radio"
                name={`vencedor-${groupId}`}
                className="size-5 accent-accent"
                disabled={disabled}
                checked={state.winnerRegistrationId === side.registrationId}
                onChange={() => setState((current) => (current ? { ...current, winnerRegistrationId: side.registrationId } : current))}
              />
              {side.name}
            </label>
          ))}
          {attempted && validation.errors.winner && (
            <p role="alert" className="flex items-center gap-1 text-xs font-medium text-danger">
              <AlertCircle className="size-3.5 shrink-0" aria-hidden />
              {validation.errors.winner}
            </p>
          )}
        </fieldset>
      )}

      <p role="status" aria-live="polite" className="text-sm text-muted" data-testid="score-status">
        {validation.valid
          ? validation.draw
            ? 'Empate. Os pontos de cada lado são calculados pelo servidor ao salvar.'
            : `${winnerName ?? 'O vencedor'} vence${match.nextMatchId ? ' e avança na chave' : ''}. Os pontos são calculados pelo servidor ao salvar.`
          : 'Preencha o placar dos dois lados.'}
      </p>

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

      <div className="flex justify-end">
        <Button type="submit" loading={submitting} disabled={disabled || uploading} iconLeft={<CheckCircle2 className="size-4" aria-hidden />}>
          {correction ? 'Salvar correção' : 'Salvar resultado'}
        </Button>
      </div>
    </form>
  );
}
