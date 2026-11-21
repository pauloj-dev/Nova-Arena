'use client';

import type { BestOf, Game, GameMode, Qualification, Seeding, StageConfig, StageFormat, StageInput } from '@nova/schemas';
import { Badge, cn, Input, Select, Switch } from '@nova/ui';
import { AlertTriangle, ArrowDown, ArrowRight, ArrowUp, ChevronDown, Copy, GripVertical, Lock, Trash2 } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { getT } from '@/shared/i18n/core';
import { useT } from '@/shared/i18n/react';
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
} from '../lib/formats';
import { BEST_OF_OPTIONS, describeQualification, SEEDING_INFO } from '../lib/labels';
import type { StageFlow, StageIssue, StageIssueField } from '../validation';
import { IssueList } from './IssueList';
import { messages } from './messages';
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

function lastDropOptions() {
  const t = getT(messages, 'StageCard');
  return [1, 1.5, 2, 3].map((v) => ({ value: String(v), label: v === 1 ? t('semMultiplicador') : t('vale', { valor: String(v).replace('.', ',') }) }));
}
const WINNER_OPTIONS = [1, 2, 4, 8, 16, 32, 64];

function qualificationOption(type: Qualification['type'], format: StageFormat): string {
  const t = getT(messages, 'StageCard');
  switch (type) {
    case 'TOP_N_PER_GROUP':
      return format === 'BATTLE_ROYALE' ? t('melhoresSala') : t('melhoresGrupo');
    case 'TOP_N_OVERALL':
      return t('melhoresGeral');
    case 'WINNERS':
      return t('vencedores');
  }
}

function flowText(flow: StageFlow | undefined, isFirst: boolean): string | null {
  if (!flow || flow.entrants === null) return null;
  const t = getT(messages, 'StageCard');
  const receives = isFirst ? t('fluxoVagas', { count: flow.entrants }) : t('fluxoRecebe', { count: flow.entrants });
  return flow.qualified === null ? receives : t('fluxoAvancam', { entrada: receives, count: flow.qualified });
}

/** Uma fase da linha do tempo: cabeçalho com ações e, aberta, todos os campos da fase. */
export function StageCard<T extends StageInput>({ stage, index, total, flow, issues, game, mode, userId, nextStageName, locked, expanded, onToggle, onChange, onMove, onDuplicate, onRemove, sortable }: StageCardProps<T>) {
  const t = useT(messages, 'StageCard');
  const baseId = useId();
  const { setNode, style: dragStyle, isDragging, handleProps } = sortable;
  const isLast = index === total - 1;
  const info = FORMAT_INFO[stage.format];
  const name = stage.name.trim() || t('faseNome', { n: index + 1 });
  const cfg = stage.config;
  const fields = configFieldsFor(stage.format, cfg);
  const issuesOf = (field: StageIssueField) => issues.filter((i) => i.field === field).map((i) => i.message);
  const setConfig = (patch: Partial<StageConfig>) => onChange({ ...stage, config: { ...cfg, ...patch } });
  const summary = flowText(flow, index === 0);
  const q = stage.qualification;
  const qualificationTypes = qualificationTypesFor(stage.format);
  const poolUnit = stage.format === 'BATTLE_ROYALE' ? 'sala' : 'grupo';
  const lastDrop = lastDropOptions();
  const qualifiedText =
    q && flow?.qualified != null
      ? t.rich('resultadoClassificacao', {
          regra: describeQualification(q, poolUnit),
          count: flow.qualified,
          proxima: nextStageName ? 'sim' : 'nao',
          nomeProxima: nextStageName ?? '',
          strong: (chunks) => <strong>{chunks}</strong>,
        })
      : null;

  function changeGroupMode(groupMode: StageConfig['groupMode']) {
    // O modo do grupo muda o tipo de partida: a pontuação e o desempate acompanham.
    const config = { ...cfg, groupMode };
    const model = defaultScoringModel(stage.format, config, { game, mode, userId });
    onChange({ ...stage, config, scoringModelId: model?.id ?? '', tiebreakers: model?.tiebreakers ?? DEFAULT_TIEBREAKERS[stageMatchType(stage.format, config, mode)] });
  }

  return (
    <li ref={setNode} style={dragStyle} className={cn('rounded-lg border bg-surface shadow-sm', issues.length > 0 ? 'border-danger' : 'border-border', isDragging && 'shadow-lg')} data-testid={`stage-card-${index}`}>
      <div className="flex items-center gap-1 p-2 md:gap-2 md:p-3">
        <button type="button" className={cn(iconButton, 'cursor-grab touch-none active:cursor-grabbing')} aria-label={t('arrastar', { nome: name })} disabled={locked || total < 2} {...handleProps}>
          <GripVertical className="size-4" aria-hidden />
        </button>
        <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={`${baseId}-body`} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md px-1 text-left hover:bg-neutral-soft focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent-soft-text" aria-hidden>
            {index + 1}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-semibold text-text">
              <span className="sr-only">{t('faseNumero', { n: index + 1 })}</span>
              {name}
            </span>
            <span className="truncate text-xs text-muted">
              {info.name}
              {summary ? ` · ${summary}` : ''}
            </span>
          </span>
          {locked && (
            <Badge tone="neutral" icon={<Lock className="size-3.5" aria-hidden />}>
              {t('jaComecou')}
            </Badge>
          )}
          {issues.length > 0 && (
            <Badge tone="danger" icon={<AlertTriangle className="size-3.5" aria-hidden />}>
              {t('pendencias', { count: issues.length })}
            </Badge>
          )}
          <ChevronDown className={cn('size-4 shrink-0 text-muted transition-transform', expanded && 'rotate-180')} aria-hidden />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1 border-t border-border px-2 py-1 md:px-3">
        <button type="button" className={iconButton} aria-label={t('moverCima', { nome: name })} disabled={locked || index === 0} onClick={() => onMove(index - 1)}>
          <ArrowUp className="size-4" aria-hidden />
        </button>
        <button type="button" className={iconButton} aria-label={t('moverBaixo', { nome: name })} disabled={locked || isLast} onClick={() => onMove(index + 1)}>
          <ArrowDown className="size-4" aria-hidden />
        </button>
        <button type="button" className={iconButton} aria-label={t('duplicar', { nome: name })} onClick={onDuplicate}>
          <Copy className="size-4" aria-hidden />
        </button>
        <button type="button" className={iconButton} aria-label={t('remover', { nome: name })} disabled={locked} onClick={onRemove}>
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
          <legend className="sr-only">{t('configuracaoDaFase', { nome: name })}</legend>
          {locked && <p className="rounded-md bg-neutral-soft px-3 py-2 text-sm text-neutral-soft-text">{t('travada')}</p>}

          <Input label={t('nomeDaFase')} value={stage.name} maxLength={60} error={issuesOf('name')[0]} onChange={(e) => onChange({ ...stage, name: e.target.value })} />

          <Section title={t('formato')} description={t('formatoDescricao', { jogo: game.name, modo: mode.name })}>
            <div role="radiogroup" aria-label={t('formatoAria', { nome: name })} className="grid gap-2 md:grid-cols-2">
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
                        {availability.available ? FORMAT_INFO[format].description : t('indisponivel', { motivo: availability.reason ?? '' })}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            <IssueList messages={issuesOf('format')} />
          </Section>

          <Section title={t('configuracao')} description={info.description}>
            <IssueList messages={issuesOf('config')} />
            <div className="grid gap-x-4 gap-y-3 md:grid-cols-2">
              {fields.includes('groupCount') && <NumberField label={t('numeroGrupos')} min={1} max={64} value={cfg.groupCount} onChange={(groupCount) => setConfig({ groupCount })} hint={flow?.poolSize ? t('porGrupo', { count: flow.poolSize }) : undefined} />}
              {fields.includes('groupMode') && (
                <Select
                  label={t('dentroDoGrupo')}
                  value={cfg.groupMode}
                  options={(['DUEL', 'BATTLE_ROYALE'] as const).map((value) => {
                    const availability = groupModeAvailability(value, game, mode);
                    return { value, label: value === 'DUEL' ? t('duelosPontosCorridos') : t('quedasBattleRoyale'), disabled: !availability.available && cfg.groupMode !== value };
                  })}
                  hint={(['DUEL', 'BATTLE_ROYALE'] as const).map((value) => groupModeAvailability(value, game, mode).reason).find(Boolean) ?? undefined}
                  onChange={(e) => changeGroupMode(e.target.value as StageConfig['groupMode'])}
                />
              )}
              {fields.includes('rounds') && <NumberField label={t('rodadasSuico')} min={1} max={15} value={cfg.rounds} onChange={(rounds) => setConfig({ rounds })} hint={t('rodadasSuicoHint')} />}
              {fields.includes('drops') && <NumberField label={stage.format === 'GROUPS' ? t('quedasPorGrupo') : t('numeroQuedas')} min={1} max={20} value={cfg.drops} onChange={(drops) => setConfig({ drops })} hint={t('quedasHint')} />}
              {fields.includes('lobbySize') && (
                <NumberField
                  label={t('equipesPorSala')}
                  min={2}
                  max={mode.maxLobbySize ?? 100}
                  value={cfg.lobbySize}
                  onChange={(lobbySize) => setConfig({ lobbySize })}
                  hint={mode.maxLobbySize ? t('salaPadraoMaximo', { modo: mode.name, maximo: mode.maxLobbySize }) : t('salaPadrao')}
                />
              )}
              {fields.includes('bestOf') && (
                <Select label={t('serie')} value={String(cfg.bestOf)} options={BEST_OF_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))} onChange={(e) => setConfig({ bestOf: Number(e.target.value) as BestOf })} />
              )}
              {fields.includes('lastDropMultiplier') && (
                <Select
                  label={t('multiplicadorUltimaQueda')}
                  value={String(cfg.lastDropMultiplier)}
                  options={lastDrop.some((o) => o.value === String(cfg.lastDropMultiplier)) ? lastDrop : [...lastDrop, { value: String(cfg.lastDropMultiplier), label: t('vale', { valor: String(cfg.lastDropMultiplier) }) }]}
                  onChange={(e) => setConfig({ lastDropMultiplier: Number(e.target.value) })}
                />
              )}
            </div>
            <div className="flex flex-col">
              {fields.includes('thirdPlace') && <Switch label={t('terceiroLugar')} hint={t('terceiroLugarHint')} checked={cfg.thirdPlace} disabled={locked} onCheckedChange={(thirdPlace) => setConfig({ thirdPlace })} />}
              {fields.includes('grandFinalReset') && (
                <Switch label={t('resetFinal')} hint={t('resetFinalHint')} checked={cfg.grandFinalReset} disabled={locked} onCheckedChange={(grandFinalReset) => setConfig({ grandFinalReset })} />
              )}
              {fields.includes('doubleRound') && <Switch label={t('turnoReturno')} hint={t('turnoReturnoHint')} checked={cfg.doubleRound} disabled={locked} onCheckedChange={(doubleRound) => setConfig({ doubleRound })} />}
              {fields.includes('killsPerPlayer') && (
                <Switch label={t('killsPorJogador')} hint={t('killsPorJogadorHint')} checked={cfg.killsPerPlayer} disabled={locked} onCheckedChange={(killsPerPlayer) => setConfig({ killsPerPlayer })} />
              )}
            </div>
          </Section>

          <Section title={t('pontuacaoEDesempate')}>
            <StageScoring stage={stage} onChange={onChange} game={game} mode={mode} userId={userId} stageName={name} scoringIssues={issuesOf('scoring')} tiebreakerIssues={issuesOf('tiebreakers')} disabled={locked} />
          </Section>

          <Section title={t('chaveamento')} description={t('chaveamentoDescricao')}>
            <Select
              label={t('metodoChaveamento')}
              value={stage.seeding}
              options={(Object.keys(SEEDING_INFO) as Seeding[]).map((value) => ({ value, label: SEEDING_INFO[value].label }))}
              hint={SEEDING_INFO[stage.seeding].description}
              onChange={(e) => onChange({ ...stage, seeding: e.target.value as Seeding })}
            />
          </Section>

          {!isLast && (
            <Section title={t('classificacao')} description={nextStageName ? t('quemAvancaPara', { nome: nextStageName }) : undefined}>
              <IssueList messages={issuesOf('qualification')} />
              {q && (
                <>
                  <div className="grid gap-x-4 gap-y-3 md:grid-cols-2">
                    <Select
                      label={t('quemAvanca')}
                      value={qualificationTypes.includes(q.type) ? q.type : ''}
                      placeholder={qualificationTypes.includes(q.type) ? undefined : t('escolhaRegra')}
                      options={qualificationTypes.map((type) => ({ value: type, label: qualificationOption(type, stage.format) }))}
                      onChange={(e) => {
                        const type = e.target.value as Qualification['type'];
                        if (type) onChange({ ...stage, qualification: { ...q, type, n: type === 'WINNERS' ? 2 : q.n } });
                      }}
                    />
                    {q.type === 'WINNERS' ? (
                      <Select
                        label={t('quantosVencedores')}
                        value={String(q.n)}
                        options={(WINNER_OPTIONS.includes(q.n) ? WINNER_OPTIONS : [...WINNER_OPTIONS, q.n]).map((n) => ({ value: String(n), label: n === 1 ? t('soCampeao') : n === 2 ? t('finalistas') : String(n) }))}
                        hint={t('vencedoresHint')}
                        onChange={(e) => onChange({ ...stage, qualification: { ...q, n: Number(e.target.value) } })}
                      />
                    ) : (
                      <NumberField
                        label={q.type === 'TOP_N_PER_GROUP' ? t('quantosAvancamDeCada', { unidade: poolUnit }) : t('quantosAvancam')}
                        min={1}
                        max={512}
                        value={q.n}
                        onChange={(n) => onChange({ ...stage, qualification: { ...q, n } })}
                      />
                    )}
                  </div>
                  <Switch
                    label={t('repescagem')}
                    hint={t('repescagemHint')}
                    checked={q.repechage > 0}
                    disabled={locked}
                    onCheckedChange={(on) => onChange({ ...stage, qualification: { ...q, repechage: on ? 1 : 0 } })}
                  />
                  {q.repechage > 0 && <NumberField label={t('quantosRepescagem')} min={1} max={64} value={q.repechage} onChange={(repechage) => onChange({ ...stage, qualification: { ...q, repechage } })} />}
                  {flow?.qualified !== null && flow?.qualified !== undefined && (
                    <p className="flex items-center gap-1.5 text-sm text-text">
                      <ArrowRight className="size-4 shrink-0 text-muted" aria-hidden />
                      <span>
                        {qualifiedText}
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
