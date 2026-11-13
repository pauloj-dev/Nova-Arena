'use client';

import type { Match, MatchParticipant, MatchStatus } from '@nova/schemas';
import { Button, cn, statusLabel } from '@nova/ui';
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, Hourglass, Maximize2, Radio, Trophy, UserX, XCircle, ZoomIn, ZoomOut, type LucideIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { matchAriaLabel, MATCH_STATUS_PILL_LABEL, shortSchedule, slotText } from '@/features/matches/matchText';
import { timeZoneLabel, userTimeZone } from '@/shared/lib/datetime';
import { DEFAULT_METRICS, layoutBracket, neighbor, participantPath, type BracketLayout, type Direction, type LayoutNode, type ParticipantPath } from './layout';
import type { SlotExtension } from './types';

export interface BracketCanvasProps extends SlotExtension {
  matches: readonly Match[];
  highlightRegistrationId?: string | null;
  onMatchSelect: (match: Match) => void;
  /** Nome acessível da chave. */
  label: string;
}

interface View {
  scale: number;
  x: number;
  y: number;
}

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 2;
const HEADER_HEIGHT = 26;
const ROW_HEIGHT = (DEFAULT_METRICS.cardHeight - HEADER_HEIGHT) / 2;
const MARGIN = 16;

const STATUS_ICON: Record<MatchStatus, { icon: LucideIcon; className: string }> = {
  SCHEDULED: { icon: CalendarClock, className: 'text-info-soft-text' },
  CHECK_IN: { icon: Clock, className: 'text-warning-soft-text' },
  LIVE: { icon: Radio, className: 'text-primary-text' },
  AWAITING_VALIDATION: { icon: Hourglass, className: 'text-warning-soft-text' },
  VALIDATED: { icon: CheckCircle2, className: 'text-primary-text' },
  DISPUTED: { icon: AlertTriangle, className: 'text-warning-soft-text' },
  WALKOVER: { icon: UserX, className: 'text-danger-soft-text' },
  CANCELLED: { icon: XCircle, className: 'text-danger-soft-text' },
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…` : text;
}

/** Zoom mantendo fixo o ponto (px, py) da área visível. */
export function zoomView(view: View, factor: number, px: number, py: number): View {
  const scale = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE);
  const k = scale / view.scale;
  return { scale, x: px - (px - view.x) * k, y: py - (py - view.y) * k };
}

/** Enquadra a chave inteira na área visível (sem ampliar além de 100%). */
export function fitView(layout: Pick<BracketLayout, 'width' | 'height'>, width: number, height: number): View {
  const scale = clamp(Math.min(width / layout.width, height / layout.height), MIN_SCALE, 1);
  return { scale, x: Math.max(0, (width - layout.width * scale) / 2), y: Math.max(0, (height - layout.height * scale) / 2) };
}

/** Desloca o mínimo necessário para o confronto aparecer inteiro. */
export function revealNode(view: View, node: Pick<LayoutNode, 'x' | 'y' | 'width' | 'height'>, width: number, height: number): View {
  let { x, y } = view;
  const left = node.x * view.scale + x;
  const right = (node.x + node.width) * view.scale + x;
  const top = node.y * view.scale + y;
  const bottom = (node.y + node.height) * view.scale + y;
  if (left < MARGIN) x += MARGIN - left;
  else if (right > width - MARGIN) x -= right - (width - MARGIN);
  if (top < MARGIN) y += MARGIN - top;
  else if (bottom > height - MARGIN) y -= bottom - (height - MARGIN);
  return x === view.x && y === view.y ? view : { ...view, x, y };
}

/** Visão inicial: legível (não reduz abaixo de 70%) e, se houver, com o confronto de quem está vendo no centro. */
function initialView(layout: BracketLayout, width: number, height: number, target: LayoutNode | undefined): View {
  const scale = clamp(width / layout.width, 0.7, 1);
  const w = layout.width * scale;
  const h = layout.height * scale;
  const place = (size: number, viewport: number, center: number | null) => {
    if (size <= viewport) return (viewport - size) / 2;
    if (center === null) return 0;
    return clamp(viewport / 2 - center * scale, viewport - size, 0);
  };
  return { scale, x: place(w, width, target ? target.x + target.width / 2 : null), y: place(h, height, target ? target.y + target.height / 2 : null) };
}

interface SlotRowProps {
  p: MatchParticipant;
  match: Match;
  index: number;
  mine: boolean;
  selected: boolean;
  width: number;
  interactive: boolean;
  onSlotClick?: SlotExtension['onSlotClick'];
  extra?: Record<string, unknown>;
}

function SlotRow({ p, match, index, mine, selected, width, interactive, onSlotClick, extra }: SlotRowProps) {
  const y = HEADER_HEIGHT + index * ROW_HEIGHT;
  const base = y + ROW_HEIGHT / 2 + 5;
  const known = p.registrationId !== null;
  const won = p.isWinner === true;
  const lost = p.isWinner === false;
  const suffix = p.status === 'WITHDRAWN' ? ' (desistiu)' : p.status === 'DISQUALIFIED' ? ' (desclassificado)' : p.isBye ? ' · bye' : '';
  const full = `${p.name}${p.tag ? ` [${p.tag}]` : ''}${suffix}`;
  const budget = (mine ? 20 : 22) - (won ? 2 : 0);

  const content = (
    <>
      {(mine || selected) && <rect x={1} y={y + 1} width={width - 2} height={ROW_HEIGHT - 2} className={selected ? 'fill-primary-soft' : 'fill-accent-soft'} />}
      {mine && <rect x={0} y={y} width={4} height={ROW_HEIGHT} className="fill-accent" />}
      {known ? (
        <>
          <text x={12} y={base} className="tabular fill-muted text-[10px]" aria-hidden>
            {p.seed ?? ''}
          </text>
          <text x={32} y={base} className={cn('text-[13px]', won ? 'fill-text font-bold' : lost ? 'fill-muted' : 'fill-text font-medium')}>
            <title>{full}</title>
            {mine ? '★ ' : ''}
            {truncate(full, budget)}
          </text>
          {won && <Trophy x={width - 58} y={y + ROW_HEIGHT / 2 - 7} width={14} height={14} className="text-gold-soft-text" aria-hidden />}
          <text x={width - 12} y={base} textAnchor="end" className={cn('tabular text-[14px]', won ? 'fill-text' : 'fill-muted')}>
            {p.score ?? '–'}
          </text>
        </>
      ) : (
        <text x={12} y={base} className="fill-muted text-[12px] italic">
          <title>{slotText(p)}</title>
          {truncate(slotText(p), 34)}
        </text>
      )}
    </>
  );

  if (!known || !interactive || !onSlotClick) {
    return (
      <g {...(known ? extra : undefined)} data-slot-registration={p.registrationId ?? undefined}>
        {content}
      </g>
    );
  }
  const activate = () => onSlotClick(p.registrationId as string, match);
  return (
    <g
      {...extra}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${p.name}${p.seed !== null ? `, cabeça de chave ${p.seed}` : ''}${selected ? ', selecionado para troca' : ''}`}
      data-slot-registration={p.registrationId}
      className="cursor-pointer outline-none focus-visible:[&>rect.slot-focus]:opacity-100"
      onClick={(e) => {
        e.stopPropagation();
        activate();
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        activate();
      }}
    >
      {/* Área de clique da linha inteira. */}
      <rect x={0} y={y} width={width} height={ROW_HEIGHT} className="fill-transparent" />
      {content}
      <rect x={2} y={y + 2} width={width - 4} height={ROW_HEIGHT - 4} rx={4} className="slot-focus pointer-events-none fill-none stroke-accent opacity-0" strokeWidth={2} />
    </g>
  );
}

interface MatchNodeProps extends SlotExtension {
  node: LayoutNode;
  inPath: boolean;
  focused: boolean;
  tabbable: boolean;
  highlightRegistrationId?: string | null;
  timeZone: string;
  onSelect: (match: Match) => void;
  onKeyDown: (event: KeyboardEvent<SVGGElement>, node: LayoutNode) => void;
  onFocus: (node: LayoutNode) => void;
  onBlur: () => void;
}

function MatchNode({ node, inPath, focused, tabbable, highlightRegistrationId, timeZone, onSelect, onKeyDown, onFocus, onBlur, selectedRegistrationId, onSlotClick, getSlotProps }: MatchNodeProps) {
  const { match, width, height } = node;
  const status = STATUS_ICON[match.status];
  const StatusIcon = status.icon;
  const when = match.scheduledAt ? shortSchedule(match.scheduledAt, timeZone) : 'Horário a definir';
  const rows = match.participants.slice(0, 2).map((p, i) => (
    <SlotRow
      key={p.registrationId ?? `vaga-${i}`}
      p={p}
      match={match}
      index={i}
      width={width}
      mine={p.registrationId !== null && p.registrationId === highlightRegistrationId}
      selected={p.registrationId !== null && p.registrationId === selectedRegistrationId}
      interactive={Boolean(onSlotClick)}
      onSlotClick={onSlotClick}
      extra={p.registrationId !== null ? getSlotProps?.(p, match) : undefined}
    />
  ));

  return (
    <g transform={`translate(${node.x} ${node.y})`}>
      <g
        role="button"
        tabIndex={tabbable ? 0 : -1}
        aria-label={matchAriaLabel(match, { timeZone, highlightRegistrationId })}
        data-match-id={match.id}
        data-testid="bracket-match"
        data-highlight={inPath ? 'true' : undefined}
        data-status={match.status}
        className="cursor-pointer outline-none"
        onClick={() => onSelect(match)}
        onKeyDown={(e) => onKeyDown(e, node)}
        onFocus={() => onFocus(node)}
        onBlur={onBlur}
      >
        <rect width={width} height={height} rx={8} className={cn('fill-surface', inPath ? 'stroke-accent' : 'stroke-border-strong')} strokeWidth={inPath ? 2.5 : 1} />
        <text x={12} y={17} className="fill-muted text-[11px]">
          {match.ifNecessary ? 'Se necessário · ' : ''}
          {when}
        </text>
        <text x={width - 28} y={17} textAnchor="end" className="fill-muted text-[11px] font-semibold">
          {MATCH_STATUS_PILL_LABEL[match.status] ?? statusLabel(match.status)}
        </text>
        <StatusIcon x={width - 24} y={6} width={14} height={14} className={status.className} aria-hidden />
        <line x1={0} x2={width} y1={HEADER_HEIGHT} y2={HEADER_HEIGHT} className="stroke-border" />
        <line x1={8} x2={width - 8} y1={HEADER_HEIGHT + ROW_HEIGHT} y2={HEADER_HEIGHT + ROW_HEIGHT} className="stroke-border" />
        {!onSlotClick && rows}
      </g>
      {onSlotClick && rows}
      {focused && <rect x={-4} y={-4} width={width + 8} height={height + 8} rx={11} className="pointer-events-none fill-none stroke-accent" strokeWidth={3} data-testid="bracket-focus-ring" />}
    </g>
  );
}

interface SceneProps extends SlotExtension {
  layout: BracketLayout;
  path: ParticipantPath;
  focusedId: string | null;
  rovingId: string | null;
  highlightRegistrationId?: string | null;
  timeZone: string;
  onSelect: (match: Match) => void;
  onKeyDown: (event: KeyboardEvent<SVGGElement>, node: LayoutNode) => void;
  onFocus: (node: LayoutNode) => void;
  onBlur: () => void;
}

/** Tudo o que não depende do zoom nem do deslocamento: arrastar a chave não redesenha os confrontos. */
const Scene = memo(function Scene({ layout, path, focusedId, rovingId, highlightRegistrationId, timeZone, onSelect, onKeyDown, onFocus, onBlur, selectedRegistrationId, onSlotClick, getSlotProps }: SceneProps) {
  return (
    <>
      {layout.sectionTitles.map((t) => (
        <text key={t.section} x={t.x} y={t.y} className="fill-text font-display text-[15px] font-bold" aria-hidden>
          {t.label}
        </text>
      ))}
      {layout.columns.map((c) => (
        <text key={c.key} x={c.x} y={c.y} className="fill-muted text-[12px] font-semibold tracking-wide uppercase" aria-hidden>
          {c.label}
        </text>
      ))}
      {layout.connectors.map((c) => {
        const walked = path.connectorIds.has(c.id);
        const projected = !walked && path.projectedConnectorIds.has(c.id);
        return (
          <path
            key={c.id}
            d={c.d}
            aria-hidden
            data-path={walked ? 'walked' : projected ? 'projected' : undefined}
            className={cn('fill-none', walked || projected ? 'stroke-accent' : 'stroke-border-strong')}
            strokeWidth={walked ? 2.5 : projected ? 2 : 1.5}
            strokeDasharray={projected ? '6 5' : undefined}
          />
        );
      })}
      {layout.nodes.map((node) => (
        <MatchNode
          key={node.id}
          node={node}
          inPath={path.matchIds.has(node.id)}
          focused={focusedId === node.id}
          tabbable={rovingId === node.id}
          highlightRegistrationId={highlightRegistrationId}
          timeZone={timeZone}
          onSelect={onSelect}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          onBlur={onBlur}
          selectedRegistrationId={selectedRegistrationId}
          onSlotClick={onSlotClick}
          getSlotProps={getSlotProps}
        />
      ))}
    </>
  );
});

/**
 * Chave eliminatória em SVG (desktop e tablet): colunas por rodada com conectores, zoom
 * (botões e Ctrl + roda do mouse), arrastar para mover e navegação por teclado
 * (setas entre os confrontos, Enter abre o detalhe).
 */
export function BracketCanvas({ matches, highlightRegistrationId, onMatchSelect, label, selectedRegistrationId, onSlotClick, getSlotProps }: BracketCanvasProps) {
  const layout = useMemo(() => layoutBracket(matches), [matches]);
  const path = useMemo(() => participantPath(layout, highlightRegistrationId), [layout, highlightRegistrationId]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const timeZone = userTimeZone();

  /** O confronto que recebe o Tab: o último visitado; senão o pendente de quem está vendo; senão o primeiro. */
  const defaultId = useMemo(() => {
    const ordered = [...layout.nodes].sort((a, b) => a.column - b.column || a.y - b.y);
    const mine = highlightRegistrationId
      ? ordered.find((n) => n.match.participants.some((p) => p.registrationId === highlightRegistrationId && p.isWinner === null))
      : undefined;
    return (mine ?? ordered[0])?.id ?? null;
  }, [layout, highlightRegistrationId]);
  const rovingId = activeId !== null && layout.nodes.some((n) => n.id === activeId) ? activeId : defaultId;

  const size = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    return { width: rect?.width || 800, height: rect?.height || 480 };
  }, []);

  // Enquadramento inicial, quando a área visível ganha tamanho (e de novo se a estrutura da chave mudar).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let first = true;
    const observer = new ResizeObserver(() => {
      if (!first) return;
      first = false;
      const rect = el.getBoundingClientRect();
      setView(initialView(layout, rect.width, rect.height, layout.nodes.find((n) => n.id === defaultId)));
    });
    observer.observe(el);
    return () => observer.disconnect();
    // Só reenquadra quando o tamanho da chave ou o confronto em foco mudam, não a cada resultado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.width, layout.height, defaultId]);

  // Ctrl + roda do mouse (ou pinça no trackpad) dá zoom; sem Ctrl, a página rola normalmente.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      setView((v) => zoomView(v, Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  function zoomBy(factor: number) {
    const { width, height } = size();
    setView((v) => zoomView(v, factor, width / 2, height / 2));
  }
  function fit() {
    const { width, height } = size();
    setView(fitView(layout, width, height));
  }
  const reveal = useCallback(
    (node: LayoutNode) => {
      const { width, height } = size();
      setView((v) => revealNode(v, node, width, height));
    },
    [size],
  );

  const onNodeFocus = useCallback(
    (node: LayoutNode) => {
      setFocusedId(node.id);
      setActiveId(node.id);
      reveal(node);
    },
    [reveal],
  );
  const onNodeBlur = useCallback(() => setFocusedId(null), []);

  // A moldura da chave pode ser mais alta que a janela: depois de enquadrar o confronto dentro dela,
  // a página rola o mínimo necessário para ele aparecer (WCAG 2.4.11, foco não encoberto).
  useEffect(() => {
    if (focusedId === null) return;
    const nodes = containerRef.current?.querySelectorAll<SVGGElement>('[data-match-id]') ?? [];
    const el = Array.from(nodes).find((n) => n.dataset.matchId === focusedId);
    // `scrollIntoView` não existe em todos os ambientes (ex.: jsdom nos testes de componente).
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [focusedId, view.x, view.y]);

  const select = useCallback(
    (match: Match) => {
      if (suppressClick.current) return;
      onMatchSelect(match);
    },
    [onMatchSelect],
  );

  const onNodeKeyDown = useCallback(
    (event: KeyboardEvent<SVGGElement>, node: LayoutNode) => {
      const focusNode = (id: string) => {
        const target = layout.nodes.find((n) => n.id === id);
        if (!target) return;
        setActiveId(id);
        const el = [...(containerRef.current?.querySelectorAll<SVGGElement>('[data-match-id]') ?? [])].find((g) => g.dataset.matchId === id);
        el?.focus({ preventScroll: true });
        reveal(target);
      };
      const directions: Record<string, Direction> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
      const direction = directions[event.key];
      if (direction) {
        event.preventDefault();
        const target = neighbor(layout, node.id, direction);
        if (target) focusNode(target);
        return;
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        const ordered = [...layout.nodes].sort((a, b) => a.column - b.column || a.y - b.y);
        const target = event.key === 'Home' ? ordered[0] : ordered[ordered.length - 1];
        if (target) focusNode(target.id);
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onMatchSelect(node.match);
      }
    },
    [layout, onMatchSelect, reveal],
  );

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    drag.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, originX: view.x, originY: view.y, moved: false };
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < 5) return;
      d.moved = true;
      setDragging(true);
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    setView((v) => ({ ...v, x: d.originX + dx, y: d.originY + dy }));
  }
  function onPointerEnd() {
    if (drag.current?.moved) {
      // O clique que encerra o arrasto não pode abrir a partida que estava embaixo do cursor.
      suppressClick.current = true;
      setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    }
    drag.current = null;
    setDragging(false);
  }

  return (
    <div className="flex flex-col gap-2" data-testid="bracket-canvas">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          Horários em {timeZoneLabel(timeZone)}. Arraste para mover, use Ctrl + roda do mouse para o zoom e as setas do teclado para andar entre os confrontos (Enter abre a partida).
          {highlightRegistrationId && path.matchIds.size > 0 ? ' Seu caminho na chave está marcado com ★ e borda mais grossa.' : ''}
        </p>
        <div role="group" aria-label="Zoom da chave" className="flex items-center gap-1">
          <Button variant="secondary" size="sm" aria-label="Diminuir zoom" disabled={view.scale <= MIN_SCALE} onClick={() => zoomBy(1 / 1.25)}>
            <ZoomOut className="size-4" aria-hidden />
          </Button>
          <span className="tabular w-12 text-center text-xs" data-testid="bracket-zoom">
            {Math.round(view.scale * 100)}%
          </span>
          <Button variant="secondary" size="sm" aria-label="Aumentar zoom" disabled={view.scale >= MAX_SCALE} onClick={() => zoomBy(1.25)}>
            <ZoomIn className="size-4" aria-hidden />
          </Button>
          <Button variant="secondary" size="sm" aria-label="Ajustar a chave à tela" iconLeft={<Maximize2 className="size-4" aria-hidden />} onClick={fit}>
            Ajustar
          </Button>
        </div>
      </div>

      <div
        ref={containerRef}
        className={cn('touch-none overflow-clip rounded-lg border border-border bg-surface-2', dragging ? 'cursor-grabbing' : 'cursor-grab')}
        style={{ height: `clamp(280px, ${Math.ceil(layout.height)}px, 70vh)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <svg width="100%" height="100%" role="group" aria-label={label} className="block select-none">
          <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
            <Scene
              layout={layout}
              path={path}
              focusedId={focusedId}
              rovingId={rovingId}
              highlightRegistrationId={highlightRegistrationId}
              timeZone={timeZone}
              onSelect={select}
              onKeyDown={onNodeKeyDown}
              onFocus={onNodeFocus}
              onBlur={onNodeBlur}
              selectedRegistrationId={selectedRegistrationId}
              onSlotClick={onSlotClick}
              getSlotProps={getSlotProps}
            />
          </g>
        </svg>
      </div>
    </div>
  );
}
