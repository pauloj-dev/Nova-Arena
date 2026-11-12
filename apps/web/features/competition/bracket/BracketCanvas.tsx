'use client';

import type { Match } from '@nova/schemas';
import { Button, cn } from '@nova/ui';
import { Check, Maximize2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { BOX_H, BOX_W, computeBracketLayout, type BracketLayout, type MatchBox } from './layout';
import { MatchSummary } from './MatchSummary';
import { hasParticipant, isPlaceholder, matchAriaLabel, matchState, matchTime, participantName, participantNote, type MatchTone } from './matchText';
import { isNavKey, neighborMatch } from './navigation';

const MIN_SCALE = 0.35;
const MAX_SCALE = 1.75;
const STEP = 1.2;
const MAX_VIEW_H = 640;
const MIN_VIEW_H = 220;
/** Movimento mínimo (px) para um clique virar arrasto. */
const DRAG_THRESHOLD = 4;
const HEADER_LINE = 24;
const ROW_H = (BOX_H - HEADER_LINE) / 2;

interface View {
  scale: number;
  x: number;
  y: number;
}

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/** Mantém o conteúdo dentro da área visível (sem "perder" a chave arrastando demais). */
function clampView(view: View, layout: BracketLayout, vw: number, vh: number): View {
  const cw = layout.width * view.scale;
  const ch = layout.height * view.scale;
  const clampAxis = (v: number, content: number, size: number) => Math.min(Math.max(v, Math.min(0, size - content)), Math.max(0, size - content));
  return { scale: view.scale, x: clampAxis(view.x, cw, vw), y: clampAxis(view.y, ch, vh) };
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const pillFill: Record<MatchTone, string> = {
  neutral: 'fill-neutral-soft',
  info: 'fill-info-soft',
  primary: 'fill-primary-soft',
  warning: 'fill-warning-soft',
  danger: 'fill-danger-soft',
};
/** Ícones do lucide usam `stroke="currentColor"`: a cor vem de `color` (classe `text-*`). */
const pillIcon: Record<MatchTone, string> = {
  neutral: 'text-neutral-soft-text',
  info: 'text-info-soft-text',
  primary: 'text-primary-soft-text',
  warning: 'text-warning-soft-text',
  danger: 'text-danger-soft-text',
};
const pillText: Record<MatchTone, string> = {
  neutral: 'fill-neutral-soft-text',
  info: 'fill-info-soft-text',
  primary: 'fill-primary-soft-text',
  warning: 'fill-warning-soft-text',
  danger: 'fill-danger-soft-text',
};

function StatePill({ match }: { match: Match }) {
  const state = matchState(match);
  const Icon = state.icon;
  const width = Math.round(state.label.length * 6.1 + 24);
  const x = BOX_W - 8 - width;
  return (
    <g aria-hidden>
      <rect x={x} y={5} width={width} height={15} rx={7.5} className={pillFill[state.tone]} />
      <Icon x={x + 5} y={7.5} width={10} height={10} strokeWidth={2.5} className={pillIcon[state.tone]} />
      <text x={x + 18} y={16} fontSize={10.5} fontWeight={700} className={pillText[state.tone]}>
        {state.label}
      </text>
    </g>
  );
}

function MatchNode({
  box,
  index,
  highlightId,
  focused,
  selected,
  onFocus,
  onActivate,
}: {
  box: MatchBox;
  index: number | undefined;
  highlightId: string | null | undefined;
  focused: boolean;
  selected: boolean;
  onFocus: (id: string) => void;
  onActivate: (id: string) => void;
}) {
  const { match } = box;
  const mine = hasParticipant(match, highlightId);
  const time = matchTime(match);
  const label = matchAriaLabel(match, { index });
  return (
    <g
      transform={`translate(${box.x} ${box.y})`}
      role="button"
      tabIndex={focused ? 0 : -1}
      aria-label={label}
      aria-pressed={selected}
      data-match-id={match.id}
      className="group cursor-pointer outline-none"
      onFocus={() => onFocus(match.id)}
      onClick={() => onActivate(match.id)}
    >
      <title>{label}</title>
      {box.caption && (
        <text x={2} y={-10} fontSize={12} fontWeight={700} className="fill-muted">
          {box.caption}
        </text>
      )}
      {/* Anel de foco visível (2 px, cor de destaque). */}
      <rect x={-5} y={-5} width={BOX_W + 10} height={BOX_H + 10} rx={12} className="fill-none stroke-accent opacity-0 group-focus-visible:opacity-100" strokeWidth={2.5} />
      <rect
        width={BOX_W}
        height={BOX_H}
        rx={8}
        className={cn('fill-surface transition-colors group-hover:fill-surface-2', mine ? 'stroke-accent' : selected ? 'stroke-text' : 'stroke-border-strong')}
        strokeWidth={mine || selected ? 2 : 1}
        strokeDasharray={match.ifNecessary ? '5 4' : undefined}
      />
      <text x={10} y={16} fontSize={11} className="fill-muted">
        {[time ?? 'A agendar', match.bestOf > 1 ? `MD${match.bestOf}` : null].filter(Boolean).join(' · ')}
      </text>
      <StatePill match={match} />
      <line x1={0} x2={BOX_W} y1={HEADER_LINE} y2={HEADER_LINE} className="stroke-border" />
      {[0, 1].map((i) => {
        const p = match.participants[i];
        const y0 = HEADER_LINE + i * ROW_H;
        const isMine = Boolean(highlightId) && p?.registrationId === highlightId;
        const winner = Boolean(p?.isWinner && p.registrationId);
        const placeholder = isPlaceholder(p);
        const note = participantNote(p);
        const name = participantName(p);
        return (
          <g key={i} aria-hidden>
            {isMine && <rect x={1} y={y0 + (i === 0 ? 0.5 : 0)} width={BOX_W - 2} height={ROW_H - (i === 1 ? 1.5 : 0.5)} rx={i === 1 ? 6 : 0} className="fill-accent-soft" />}
            {i === 1 && <line x1={0} x2={BOX_W} y1={y0} y2={y0} className="stroke-border" />}
            {p?.seed != null && (
              <text x={10} y={y0 + ROW_H / 2 + 4} fontSize={10} className="tabular fill-muted">
                {p.seed}
              </text>
            )}
            <text
              x={28}
              y={y0 + ROW_H / 2 + 4.5}
              fontSize={13}
              fontWeight={winner ? 700 : 500}
              fontStyle={placeholder ? 'italic' : undefined}
              textDecoration={note ? 'line-through' : undefined}
              className={isMine ? 'fill-accent-soft-text' : placeholder ? 'fill-muted' : 'fill-text'}
            >
              {truncate(name, placeholder ? 26 : 20)}
            </text>
            {winner && <Check x={BOX_W - 40} y={y0 + ROW_H / 2 - 6} width={12} height={12} strokeWidth={3} className="text-primary-text" />}
            <text x={BOX_W - 12} y={y0 + ROW_H / 2 + 4.5} fontSize={13} fontWeight={winner ? 700 : 500} textAnchor="end" className={cn('tabular', winner ? 'fill-text' : 'fill-muted')}>
              {p?.score ?? ''}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export interface BracketCanvasProps {
  matches: Match[];
  label: string;
  highlightRegistrationId?: string | null;
  onSelectMatch?: (match: Match) => void;
}

/** Chave em SVG para telas largas: zoom (botões, teclas +/− ou Ctrl + roda), arrastar e navegação por setas. */
export function BracketCanvas({ matches, label, highlightRegistrationId, onSelectMatch }: BracketCanvasProps) {
  const layout = useMemo(() => computeBracketLayout(matches), [matches]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [fitted, setFitted] = useState<string | null>(null);
  const drag = useRef<{ id: number; px: number; py: number; x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);

  // Partida da chave que entra no Tab (roving tabindex): a próxima do participante destacado, ou a primeira.
  const initialFocus = useMemo(() => {
    const mine = layout.boxes.filter((b) => hasParticipant(b.match, highlightRegistrationId));
    const pending = mine.filter((b) => !['VALIDATED', 'WALKOVER', 'CANCELLED'].includes(b.match.status));
    const pick = pending[0] ?? mine[mine.length - 1] ?? [...layout.boxes].sort((a, b) => a.column - b.column || a.y - b.y)[0];
    return pick?.match.id ?? null;
  }, [layout, highlightRegistrationId]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const activeFocus = focusedId && layout.boxes.some((b) => b.match.id === focusedId) ? focusedId : initialFocus;
  const selected = selectedId ? layout.boxes.find((b) => b.match.id === selectedId)?.match : undefined;

  // Número da partida dentro da rodada ("Quartas 2"), só quando a rodada tem mais de uma.
  const indexOf = useMemo(() => {
    const map = new Map<string, number | undefined>();
    const byColumn = new Map<string, MatchBox[]>();
    for (const b of layout.boxes) {
      const key = `${b.section}-${b.column}-${b.match.bracket}`;
      byColumn.set(key, [...(byColumn.get(key) ?? []), b]);
    }
    for (const list of byColumn.values()) {
      list.sort((a, b) => a.y - b.y);
      list.forEach((b, i) => map.set(b.match.id, list.length > 1 ? i + 1 : undefined));
    }
    return map;
  }, [layout]);

  // Mede a área visível. A altura acompanha a chave, até um limite.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Encaixa a chave na largura quando ela (ou a largura) muda.
  const fitKey = `${layout.width}x${layout.height}@${size.w}`;
  const fitScale = size.w > 0 ? clampScale(Math.min(1, size.w / layout.width)) : 1;
  const viewHeight = Math.round(Math.min(MAX_VIEW_H, Math.max(MIN_VIEW_H, layout.height * fitScale)));
  // Ajuste de estado durante a renderização (padrão do React para "derivar do que mudou"), sem efeito.
  if (size.w > 0 && fitted !== fitKey) {
    setFitted(fitKey);
    setView(clampView({ scale: fitScale, x: 0, y: 0 }, layout, size.w, viewHeight));
  }

  const apply = useCallback((next: View) => setView(clampView(next, layout, size.w, viewHeight)), [layout, size.w, viewHeight]);

  const zoomAt = useCallback(
    (factor: number, px = size.w / 2, py = viewHeight / 2) => {
      setView((v) => {
        const scale = clampScale(v.scale * factor);
        const ratio = scale / v.scale;
        return clampView({ scale, x: px - (px - v.x) * ratio, y: py - (py - v.y) * ratio }, layout, size.w, viewHeight);
      });
    },
    [layout, size.w, viewHeight],
  );

  // Ctrl/⌘ + roda aproxima no ponteiro. A roda sozinha continua rolando a página.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  /** Traz a partida para dentro da área visível (quando o foco chega nela pelo teclado). */
  const reveal = useCallback(
    (id: string) => {
      const box = layout.boxes.find((b) => b.match.id === id);
      if (!box || size.w === 0) return;
      setView((v) => {
        const left = v.x + box.x * v.scale;
        const top = v.y + box.y * v.scale;
        const w = BOX_W * v.scale;
        const h = BOX_H * v.scale;
        const margin = 24;
        let { x, y } = v;
        if (left < margin || left + w > size.w - margin) x = size.w / 2 - (box.x + BOX_W / 2) * v.scale;
        if (top < margin || top + h > viewHeight - margin) y = viewHeight / 2 - (box.y + BOX_H / 2) * v.scale;
        return clampView({ scale: v.scale, x, y }, layout, size.w, viewHeight);
      });
    },
    [layout, size.w, viewHeight],
  );

  const focusMatch = (id: string) => {
    setFocusedId(id);
    const el = svgRef.current?.querySelector<SVGGElement>(`[data-match-id="${CSS.escape(id)}"]`);
    el?.focus({ preventScroll: true });
  };

  const activate = (id: string) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    setFocusedId(id);
    setSelectedId((cur) => (cur === id ? null : id));
    const match = layout.boxes.find((b) => b.match.id === id)?.match;
    if (match) onSelectMatch?.(match);
  };

  function onKeyDown(e: KeyboardEvent<SVGSVGElement>) {
    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      zoomAt(STEP);
      return;
    }
    if (e.key === '-') {
      e.preventDefault();
      zoomAt(1 / STEP);
      return;
    }
    const target = (e.target as Element).closest('[data-match-id]');
    const id = target?.getAttribute('data-match-id');
    if (!id) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activate(id);
      return;
    }
    if (e.key === 'Escape' && selectedId) {
      e.preventDefault();
      setSelectedId(null);
      return;
    }
    if (!isNavKey(e.key)) return;
    e.preventDefault();
    const next = neighborMatch(layout, id, e.key);
    if (next) focusMatch(next);
  }

  function onPointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    if (e.button !== 0 || e.pointerType === 'touch') return;
    drag.current = { id: e.pointerId, px: e.clientX, py: e.clientY, x: view.x, y: view.y, moved: false };
  }
  function onPointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!d.moved) {
      d.moved = true;
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    apply({ scale: view.scale, x: d.x + dx, y: d.y + dy });
  }
  function onPointerUp(e: ReactPointerEvent<SVGSVGElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (d.moved) {
      suppressClick.current = true;
      // O clique que vem depois do arrasto cai no próprio SVG; limpa no próximo ciclo.
      window.setTimeout(() => (suppressClick.current = false), 0);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    }
    drag.current = null;
    setDragging(false);
  }

  const highlightedConnectors = new Set(
    layout.connectors
      .filter((c) => {
        const from = layout.boxes.find((b) => b.match.id === c.fromId)?.match;
        const to = layout.boxes.find((b) => b.match.id === c.toId)?.match;
        return Boolean(from && to && hasParticipant(from, highlightRegistrationId) && hasParticipant(to, highlightRegistrationId));
      })
      .map((c) => c.key),
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">Arraste para mover · Ctrl + roda do mouse ou as teclas + e − para aproximar · Setas para andar entre as partidas</p>
        <div className="flex items-center gap-1" role="group" aria-label="Zoom da chave">
          <Button size="sm" variant="secondary" aria-label="Afastar" onClick={() => zoomAt(1 / STEP)} disabled={view.scale <= MIN_SCALE + 0.001}>
            <ZoomOut className="size-4" aria-hidden />
          </Button>
          <span className="tabular w-12 text-center text-sm text-muted" aria-live="polite" aria-label={`Zoom em ${Math.round(view.scale * 100)}%`}>
            {Math.round(view.scale * 100)}%
          </span>
          <Button size="sm" variant="secondary" aria-label="Aproximar" onClick={() => zoomAt(STEP)} disabled={view.scale >= MAX_SCALE - 0.001}>
            <ZoomIn className="size-4" aria-hidden />
          </Button>
          <Button size="sm" variant="secondary" onClick={() => apply({ scale: fitScale, x: 0, y: 0 })} iconLeft={<Maximize2 className="size-4" aria-hidden />}>
            Ajustar
          </Button>
        </div>
      </div>

      <div
        ref={viewportRef}
        className="relative overflow-hidden rounded-lg border border-border bg-bg"
        style={{ height: viewHeight }}
        // O foco em uma partida fora da área não pode rolar o contêiner: quem move é o `reveal`.
        onScroll={(e) => {
          e.currentTarget.scrollTop = 0;
          e.currentTarget.scrollLeft = 0;
        }}
      >
        <svg
          ref={svgRef}
          role="group"
          aria-label={label}
          aria-roledescription="chave"
          width="100%"
          height="100%"
          className={cn('block touch-pan-y select-none', dragging ? 'cursor-grabbing' : 'cursor-grab')}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onFocus={(e) => {
            const id = (e.target as Element).getAttribute?.('data-match-id');
            if (id) reveal(id);
          }}
        >
          <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
            {layout.sections.map((s) => (
              <text key={s.key} x={16} y={s.y + 16} fontSize={15} fontWeight={700} className="fill-text">
                {s.label}
              </text>
            ))}
            {layout.columns.map((c) => (
              <text key={c.key} x={c.x + 2} y={c.y + 20} fontSize={12} fontWeight={700} className="fill-muted" aria-hidden>
                {c.label}
              </text>
            ))}
            <g aria-hidden fill="none">
              {layout.connectors
                .filter((c) => !highlightedConnectors.has(c.key))
                .map((c) => (
                  <path key={c.key} d={c.d} className="stroke-border-strong" strokeWidth={1.5} />
                ))}
              {layout.connectors
                .filter((c) => highlightedConnectors.has(c.key))
                .map((c) => (
                  <path key={c.key} d={c.d} className="stroke-accent" strokeWidth={3} data-highlighted="true" />
                ))}
            </g>
            {layout.boxes.map((box) => (
              <MatchNode
                key={box.match.id}
                box={box}
                index={indexOf.get(box.match.id)}
                highlightId={highlightRegistrationId}
                focused={activeFocus === box.match.id}
                selected={selectedId === box.match.id}
                onFocus={setFocusedId}
                onActivate={activate}
              />
            ))}
          </g>
        </svg>
      </div>

      <div aria-live="polite">
        {selected && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base">Partida selecionada</h3>
              <Button size="sm" variant="ghost" onClick={() => setSelectedId(null)} iconLeft={<X className="size-4" aria-hidden />}>
                Fechar
              </Button>
            </div>
            <MatchSummary match={selected} highlightRegistrationId={highlightRegistrationId} className="max-w-md" />
          </div>
        )}
      </div>
    </div>
  );
}
