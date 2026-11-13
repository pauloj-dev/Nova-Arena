'use client';

import type { SiteBannerItem } from '@nova/schemas';
import { cn } from '@nova/ui';
import { Megaphone, Wrench, X } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { useSiteBanner } from '../api/hooks/admin-tournaments';
import { formatDateTime } from '../lib/datetime';

/**
 * Avisos dispensados ficam guardados no navegador (por aviso). Manutenção em curso não pode ser dispensada.
 * `useSyncExternalStore` mantém todas as abas e instâncias do banner em sincronia, sem estado duplicado.
 */
const STORAGE_KEY = 'nova-banners-dispensados';
const listeners = new Set<() => void>();
let cache: { raw: string | null; ids: string[] } = { raw: null, ids: [] };

function read(): string[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (raw === cache.raw) return cache.ids;
  let ids: string[] = [];
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) ids = parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    ids = [];
  }
  cache = { raw, ids };
  return ids;
}

function dismiss(id: string): void {
  // Guarda só os 50 mais recentes: avisos antigos não voltam e a lista não cresce para sempre.
  const next = [...read().filter((x) => x !== id), id].slice(-50);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    cache = { raw: JSON.stringify(next), ids: next };
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

const NO_IDS: string[] = [];

function period(item: SiteBannerItem): string | null {
  if (item.kind !== 'MAINTENANCE' || !item.startsAt || !item.endsAt) return null;
  return item.ongoing ? `Previsão de volta: ${formatDateTime(item.endsAt)}.` : `De ${formatDateTime(item.startsAt, { withZone: false })} até ${formatDateTime(item.endsAt)}.`;
}

/**
 * Aviso global no topo do site: banners e avisos de manutenção publicados pelo Admin em Comunicados.
 * Cada aviso pode ser dispensado, menos a manutenção em curso. Sem avisos, não ocupa espaço.
 */
export function SiteBanner() {
  const banners = useSiteBanner();
  const dismissed = useSyncExternalStore(
    subscribe,
    read,
    () => NO_IDS,
  );
  const visible = (banners.data ?? []).filter((item) => !item.dismissible || !dismissed.includes(item.id));
  if (visible.length === 0) return null;

  return (
    <div role="region" aria-label="Avisos da Nova Arena" className="flex flex-col">
      {visible.map((item) => {
        const maintenance = item.kind === 'MAINTENANCE';
        const Icon = maintenance ? Wrench : Megaphone;
        const when = period(item);
        return (
          <div
            key={item.id}
            role="status"
            data-testid="site-banner"
            data-kind={item.kind}
            className={cn('border-b border-border-strong', maintenance ? 'bg-warning-soft text-warning-soft-text' : 'bg-info-soft text-info-soft-text')}
          >
            <div className="mx-auto flex max-w-[1280px] items-start gap-3 px-4 py-2 md:px-6">
              <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
                <strong className="font-semibold">
                  {maintenance && (item.ongoing ? 'Manutenção em andamento: ' : 'Manutenção programada: ')}
                  {item.title}
                </strong>{' '}
                {item.body}
                {when && <> {when}</>}
              </p>
              {item.dismissible && (
                <button type="button" onClick={() => dismiss(item.id)} aria-label={`Dispensar o aviso: ${item.title}`} className="-my-1 flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-surface/40 md:size-8">
                  <X className="size-4" aria-hidden />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
