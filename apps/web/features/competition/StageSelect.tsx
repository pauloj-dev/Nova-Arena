'use client';

import type { Stage } from '@nova/schemas';
import { Select } from '@nova/ui';

/** Escolha da fase quando o campeonato tem mais de uma que se encaixa na aba. */
export function StageSelect({ stages, value, onChange }: { stages: Stage[]; value: string; onChange: (id: string) => void }) {
  if (stages.length < 2) return null;
  return <Select label="Fase" className="max-w-xs" value={value} onChange={(e) => onChange(e.target.value)} options={stages.map((s) => ({ value: s.id, label: s.name }))} />;
}

/** Campeonato já com chaves sorteadas (ou prestes a ter): a partir do fechamento das inscrições. */
export const COMPETITION_STATUSES = new Set(['REGISTRATION_CLOSED', 'CHECK_IN', 'IN_PROGRESS', 'PAUSED', 'FINISHED']);
