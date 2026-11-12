import type { Report } from '@nova/schemas';
import type { Status } from '@nova/ui';

/** Como cada status de denúncia aparece no `StatusPill` (ícone + texto). */
export const REPORT_STATUS: Record<Report['status'], { status: Status; label: string; help: string }> = {
  OPEN: { status: 'OPEN', label: 'Aberta', help: 'Aguardando a análise da moderação.' },
  IN_REVIEW: { status: 'IN_REVIEW', label: 'Em análise', help: 'A moderação está analisando.' },
  ACTIONED: { status: 'RESOLVED', label: 'Medida aplicada', help: 'A moderação analisou e tomou uma medida.' },
  DISMISSED: { status: 'COMPLETED', label: 'Arquivada', help: 'A moderação analisou e não aplicou medida.' },
};

export const REPORT_TARGET_LABELS: Record<Report['targetType'], string> = {
  USER: 'Jogador',
  TEAM: 'Squad',
  MATCH: 'Partida',
  RESULT: 'Resultado',
};
