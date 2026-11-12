'use client';

import type { BestOf, Game, GameMode, Qualification, Seeding, StageConfig, StageFormat, StageInput } from '@nova/schemas';
import { Badge, cn, Input, Select, Switch } from '@nova/ui';
import { AlertTriangle, ArrowDown, ArrowRight, ArrowUp, ChevronDown, Copy, GripVertical, Lock, Trash2 } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { NumberField } from '../components/NumberField';
import {
  changeStageFormat,
  configFieldsFor,
  defaultScoringModel,
  DEFAULT_TIEBREAKERS,
  FORMAT_INFO,
  formatAvailability,
  groupModeAvailability,
  qualificationTypesFor,
  STAGE_FORMAT_ORDER,
  stageMatchType,
  type StageConfigField,
} from '../lib/formats';
import { BEST_OF_OPTIONS, describeQualification, SEEDING_INFO } from '../lib/labels';
import type { StageFlow, StageIssue, StageIssueField } from '../validation';
import { IssueList } from './IssueList';
import type { SortableRow } from './Sortable';
import { StageScoring } from './StageScoring';

export interface StageCardProps<T extends StageInput> {
  stage: T;
  index: number;
  total: number;
  flow: StageFlow | undefined;
  issues: StageIssue[];
  game: Game;
  mode: GameMode;
  userId: string | null;
  /** Nome da próxima fase (para a frase "avançam N para …"). */
  nextStageName: string | null;
  /** Fase que já começou: só leitura. */
  locked: boolean;
  expanded: boolean;
  onToggle: () => void;
  onChange: (stage: T) => void;
  onMove: (to: number) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  sortable: SortableRow;
}

const iconButton =
  'flex size-11 shrink-0 items-center justify-center rounded-md text-muted hover:bg-neutral-soft hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-40 disabled:hover:bg-transparent md:size-9';

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-border pt-4">
      <div>
        <h4 className="text-sm font-semibold text-text">{title}</h4>
        {description && <p className="text-xs text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

const LAST_DROP_OPTIONS = [1, 1.5, 2, 3].map((v) => ({ value: String(v), label: v === 1 ? 'Sem multiplicador' : `Vale ×${String(v).replace('.', ',')}` }));
const WINNER_OPTIONS = [1, 2, 4, 8, 16, 32, 64];

const QUALIFICATION_OPTION: Record<Qualification['type'], (format: StageFormat) => string> = {
  TOP_N_PER_GROUP: (format) => (format === 'BATTLE_ROYALE' ? 'Os melhores de cada sala' : 'Os melhores de cada grupo'),
  TOP_N_OVERALL: () => 'Os melhores da tabela geral',
  WINNERS: () => 'Os vencedores do mata-mata',
};

function flowText(flow: StageFlow | undefined, isFirst: boolean): string | null {
  if (!flow || flow.entrants === null) return null;
  const receives = isFirst ? `${flow.entrants} vagas` : `Recebe ${flow.entrants}`;
  return flow.qualified === null ? receives : `${receives} → avançam ${flow.qualified}`;
}

/** Uma fase da linha do tempo: cabeçalho com ações e, aberta, todos os campos da fase. */
export function StageCard<T extends StageInput>({ stage, index, total, flow, issues, game, mode, userId, nextStageName, locked, expanded, onToggle, onChange, onMove, onDuplicate, onRemove, sortable }: StageCardProps<T>) {
  const baseId = useId();
  const { setNode, style: dragStyle, isDragging, handleProps } = sortable;
  const isLast = index === total - 1;
  const info = FORMAT_INFO[stage.format];
  const name = stage.name.trim() || `Fase ${index + 1}`;
  const cfg = stage.config;
  const fields = configFieldsFor(stage.format, cfg);
  const has = (field: StageConfigField) => fields.includes(field);
  const messages = (field: StageIssueField) => issues.filter((i) => i.field === field).map((i) => i.message);
  const setConfig = (patch: Partial<StageConfig>) => onChange({ ...stage, config: { ...cfg, ...patch } });
  const summary = flowText(flow, index === 0);
  const q = stage.qualification;
  const qualificationTypes = qualificationTypesFor(stage.format);
  const poolUnit = stage.format === 'BATTLE_ROYALE' ? 'sala' : 'grupo';

  function changeGroupMode(groupMode: StageConfig['groupMode']) {
    // O modo do grupo muda o tipo de partida: a pontuação e o desempate acompanham.
    const config = { ...cfg, groupMode };
    const model = defaultScoringModel(stage.format, config, { game, mode, userId });
    onChange({ ...stage, config, scoringModelId: model?.id ?? '', tiebreakers: model?.tiebreakers ?? DEFAULT_TIEBREAKERS[stageMatchType(stage.format, config, mode)] });
  }

  return (
    <li ref={setNode} style={dragStyle} className={cn('rounded-lg border bg-surface shadow-sm', issues.length > 0 ? 'border-danger' : 'border-border', isDragging && 'shadow-lg')} data-testid={`stage-card-${index}`}>
      <div className="flex items-center gap-1 p-2 md:gap-2 md:p-3">
        <button type="button" className={cn(iconButton, 'cursor-grab touch-none active:cursor-grabbing')} aria-label={`Arrastar a fase ${name} para reordenar`} disabled={locked || total < 2} {...handleProps}>
          <GripVertical className="size-4" aria-hidden />
        </button>
        <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={`${baseId}-body`} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md px-1 text-left hover:bg-neutral-soft focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent-soft-text" aria-hidden>
            {index + 1}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-semibold text-text">
              <span className="sr-only">Fase {index + 1}: </span>
              {name}
            </span>
            <span className="truncate text-xs text-muted">
              {info.name}
              {summary ? ` · ${summary}` : ''}
            </span>
          </span>
          {locked && (
            <Badge tone="neutral" icon={<Lock className="size-3.5" aria-hidden />}>
              Já começou
            </Badge>
          )}
          {issues.length > 0 && (
            <Badge tone="danger" icon={<AlertTriangle className="size-3.5" aria-hidden />}>
              {issues.length} {issues.length === 1 ? 'pendência' : 'pendências'}
            </Badge>
          )}
          <ChevronDown className={cn('size-4 shrink-0 text-muted transition-transform', expanded && 'rotate-180')} aria-hidden />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1 border-t border-border px-2 py-1 md:px-3">
        <button type="button" className={iconButton} aria-label={`Mover a fase ${name} para cima`} disabled={locked || index === 0} onClick={() => onMove(index - 1)}>
          <ArrowUp className="size-4" aria-hidden />
        </button>
        <button type="button" className={iconButton} aria-label={`Mover a fase ${name} para baixo`} disabled={locked || isLast} onClick={() => onMove(index + 1)}>
          <ArrowDown className="size-4" aria-hidden />
        </button>
        <button type="button" className={iconButton} aria-label={`Duplicar a fase ${name}`} onClick={onDuplicate}>
          <Copy className="size-4" aria-hidden />
        </button>
        <button type="button" className={iconButton} aria-label={`Remover a fase ${name}`} disabled={locked} onClick={onRemove}>
          <Trash2 className="size-4" aria-hidden />
        </button>
        {!expanded && q && (
          <span className="ml-auto flex min-w-0 items-center gap-1 truncate pr-1 text-xs text-muted">
            <ArrowRight className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{describeQualification(q, poolUnit)}</span>
          </span>
        )}
      </div>

      {expanded && (
        <fieldset id={`${baseId}-body`} disabled={locked} className="flex min-w-0 flex-col gap-4 border-t border-border p-3 md:p-4">
          <legend className="sr-only">Configuração da fase {name}</legend>
          {locked && <p className="rounded-md bg-neutral-soft px-3 py-2 text-sm text-neutral-soft-text">Esta fase já começou e não pode mais ser alterada.</p>}

          <Input label="Nome da fase" value={stage.name} maxLength={60} error={messages('name')[0]} onChange={(e) => onChange({ ...stage, name: e.target.value })} />

          <Section title="Formato" description={`Formatos que não servem para ${game.name} · ${mode.name} ficam desabilitados, com o motivo.`}>
            <div role="radiogroup" aria-label={`Formato da fase ${name}`} className="grid gap-2 md:grid-cols-2">
              {STAGE_FORMAT_ORDER.map((format) => {
                const availability = formatAvailability(format, game, mode);
                const checked = stage.format === format;
                const optionId = `${baseId}-format-${format}`;
                return (
                  <label
                    key={format}
                    htmlFor={optionId}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-md border p-3 has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-accent',
                      checked ? 'border-accent bg-accent-soft' : 'border-border hover:bg-surface-2',
                      !availability.available && 'cursor-not-allowed bg-surface-2 opacity-70 hover:bg-surface-2',
                    )}
                  >
                    <input
                      id={optionId}
                      type="radio"
                      name={`${baseId}-format`}
                      className="mt-1 size-4 shrink-0 accent-(--accent)"
                      checked={checked}
                      disabled={!availability.available && !checked}
                      aria-describedby={`${optionId}-desc`}
                      onChange={() => onChange(changeStageFormat(stage, format, { game, mode, userId }))}
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="text-sm font-semibold text-text">{FORMAT_INFO[format].name}</span>
                      <span id={`${optionId}-desc`} className="text-xs text-muted">
                        {availability.available ? FORMAT_INFO[format].description : `Indisponível: ${availability.reason}`}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            <IssueList messages={messages('format')} />
          </Section>

          <Section title="Configuração" description={info.description}>
            <IssueList messages={messages('config')} />
            <div className="grid gap-x-4 gap-y-3 md:grid-cols-2">
              {has('groupCount') && <NumberField label="Número de grupos" min={1} max={64} value={cfg.groupCount} onChange={(groupCount) => setConfig({ groupCount })} hint={flow?.poolSize ? `Até ${flow.poolSize} por grupo.` : undefined} />}
              {has('groupMode') && (
                <Select
                  label="Dentro do grupo"
                  value={cfg.groupMode}
                  options={(['DUEL', 'BATTLE_ROYALE'] as const).map((value) => {
                    const availability = groupModeAvailability(value, game, mode);
                    return { value, label: value === 'DUEL' ? 'Duelos em pontos corridos' : 'Quedas Battle Royale', disabled: !availability.available && cfg.groupMode !== value };
                  })}
                  hint={(['DUEL', 'BATTLE_ROYALE'] as const).map((value) => groupModeAvailability(value, game, mode).reason).find(Boolean) ?? undefined}
                  onChange={(e) => changeGroupMode(e.target.value as StageConfig['groupMode'])}
                />
              )}
              {has('rounds') && <NumberField label="Rodadas do suíço" min={1} max={15} value={cfg.rounds} onChange={(rounds) => setConfig({ rounds })} hint="Cada rodada junta quem tem campanha parecida." />}
              {has('drops') && <NumberField label={stage.format === 'GROUPS' ? 'Quedas por grupo' : 'Número de quedas'} min={1} max={20} value={cfg.drops} onChange={(drops) => setConfig({ drops })} hint="Os pontos de todas as quedas são somados." />}
              {has('lobbySize') && (
                <NumberField
                  label="Equipes por sala"
                  min={2}
                  max={mode.maxLobbySize ?? 100}
                  value={cfg.lobbySize}
                  onChange={(lobbySize) => setConfig({ lobbySize })}
                  hint={`Padrão: 12.${mode.maxLobbySize ? ` Máximo em ${mode.name}: ${mode.maxLobbySize}.` : ''}`}
                />
              )}
              {has('bestOf') && (
                <Select label="Série de cada confronto" value={String(cfg.bestOf)} options={BEST_OF_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))} onChange={(e) => setConfig({ bestOf: Number(e.target.value) as BestOf })} />
              )}
              {has('lastDropMultiplier') && (
                <Select
                  label="Multiplicador da última queda"
                  value={String(cfg.lastDropMultiplier)}
                  options={LAST_DROP_OPTIONS.some((o) => o.value === String(cfg.lastDropMultiplier)) ? LAST_DROP_OPTIONS : [...LAST_DROP_OPTIONS, { value: String(cfg.lastDropMultiplier), label: `Vale ×${cfg.lastDropMultiplier}` }]}
                  onChange={(e) => setConfig({ lastDropMultiplier: Number(e.target.value) })}
                />
              )}
            </div>
            <div className="flex flex-col">
              {has('thirdPlace') && <Switch label="Disputa de 3º lugar" hint="Os perdedores das semifinais jogam pelo 3º lugar." checked={cfg.thirdPlace} disabled={locked} onCheckedChange={(thirdPlace) => setConfig({ thirdPlace })} />}
              {has('grandFinalReset') && (
                <Switch label="Reset da grande final" hint="Se quem veio da chave de perdedores vencer a final, joga-se mais uma." checked={cfg.grandFinalReset} disabled={locked} onCheckedChange={(grandFinalReset) => setConfig({ grandFinalReset })} />
              )}
              {has('doubleRound') && <Switch label="Turno e returno" hint="Cada confronto acontece duas vezes." checked={cfg.doubleRound} disabled={locked} onCheckedChange={(doubleRound) => setConfig({ doubleRound })} />}
              {has('killsPerPlayer') && (
                <Switch label="Lançar kills por jogador" hint="Ativa o ranking de MVP da fase. Desligado, as kills são lançadas por equipe." checked={cfg.killsPerPlayer} disabled={locked} onCheckedChange={(killsPerPlayer) => setConfig({ killsPerPlayer })} />
              )}
            </div>
          </Section>

          <Section title="Pontuação e desempate">
            <StageScoring stage={stage} onChange={onChange} game={game} mode={mode} userId={userId} stageName={name} scoringIssues={messages('scoring')} tiebreakerIssues={messages('tiebreakers')} disabled={locked} />
          </Section>

          <Section title="Chaveamento" description="Como os participantes são distribuídos quando a chave desta fase for gerada.">
            <Select
              label="Método de chaveamento"
              value={stage.seeding}
              options={(Object.keys(SEEDING_INFO) as Seeding[]).map((value) => ({ value, label: SEEDING_INFO[value].label }))}
              hint={SEEDING_INFO[stage.seeding].description}
              onChange={(e) => onChange({ ...stage, seeding: e.target.value as Seeding })}
            />
          </Section>

          {!isLast && (
            <Section title="Classificação para a próxima fase" description={nextStageName ? `Quem avança para "${nextStageName}".` : undefined}>
              <IssueList messages={messages('qualification')} />
              {q && (
                <>
                  <div className="grid gap-x-4 gap-y-3 md:grid-cols-2">
                    <Select
                      label="Quem avança"
                      value={qualificationTypes.includes(q.type) ? q.type : ''}
                      placeholder={qualificationTypes.includes(q.type) ? undefined : 'Escolha a regra…'}
                      options={qualificationTypes.map((type) => ({ value: type, label: QUALIFICATION_OPTION[type](stage.format) }))}
                      onChange={(e) => {
                        const type = e.target.value as Qualification['type'];
                        if (type) onChange({ ...stage, qualification: { ...q, type, n: type === 'WINNERS' ? 2 : q.n } });
                      }}
                    />
                    {q.type === 'WINNERS' ? (
                      <Select
                        label="Quantos vencedores avançam"
                        value={String(q.n)}
                        options={(WINNER_OPTIONS.includes(q.n) ? WINNER_OPTIONS : [...WINNER_OPTIONS, q.n]).map((n) => ({ value: String(n), label: n === 1 ? '1 (só o campeão)' : n === 2 ? '2 (os finalistas)' : String(n) }))}
                        hint="Com 2, o mata-mata para nas semifinais e os dois finalistas avançam."
                        onChange={(e) => onChange({ ...stage, qualification: { ...q, n: Number(e.target.value) } })}
                      />
                    ) : (
                      <NumberField
                        label={q.type === 'TOP_N_PER_GROUP' ? `Quantos avançam de cada ${poolUnit}` : 'Quantos avançam'}
                        min={1}
                        max={512}
                        value={q.n}
                        onChange={(n) => onChange({ ...stage, qualification: { ...q, n } })}
                      />
                    )}
                  </div>
                  <Switch
                    label="Repescagem"
                    hint="Completa a próxima fase com os melhores entre os eliminados. Desligada por padrão."
                    checked={q.repechage > 0}
                    disabled={locked}
                    onCheckedChange={(on) => onChange({ ...stage, qualification: { ...q, repechage: on ? 1 : 0 } })}
                  />
                  {q.repechage > 0 && <NumberField label="Quantos entram pela repescagem" min={1} max={64} value={q.repechage} onChange={(repechage) => onChange({ ...stage, qualification: { ...q, repechage } })} />}
                  {flow?.qualified !== null && flow?.qualified !== undefined && (
                    <p className="flex items-center gap-1.5 text-sm text-text">
                      <ArrowRight className="size-4 shrink-0 text-muted" aria-hidden />
                      <span>
                        {describeQualification(q, poolUnit)}: <strong>{flow.qualified}</strong> {flow.qualified === 1 ? 'avança' : 'avançam'}
                        {nextStageName ? ` para "${nextStageName}"` : ''}.
                      </span>
                    </p>
                  )}
                </>
              )}
            </Section>
          )}
        </fieldset>
      )}
    </li>
  );
}
