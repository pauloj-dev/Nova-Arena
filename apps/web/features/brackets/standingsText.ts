/**
 * Textos da classificação: resumo das mudanças de posição (lido pela região `aria-live`)
 * e formatação de números. Funções puras.
 */
import type { StandingRow } from '@nova/schemas';

type RowRef = Pick<StandingRow, 'registrationId' | 'position' | 'name' | 'points'>;

const MAX_SPOKEN = 3;

/**
 * Resumo curto do que mudou entre duas versões da mesma tabela. Vazio quando nada mudou ou
 * quando as tabelas não são comparáveis (outro grupo, outra fase).
 * "Classificação atualizada: Squad Alfa subiu para 1º; Squad Bravo caiu para 2º."
 */
export function summarizeChanges(previous: readonly RowRef[], next: readonly RowRef[], highlightRegistrationId?: string | null): string {
  const before = new Map(previous.map((r) => [r.registrationId, r]));
  const common = next.filter((r) => before.has(r.registrationId));
  if (common.length === 0) return '';

  const moved = common
    .filter((r) => before.get(r.registrationId)?.position !== r.position)
    .sort((a, b) => Number(b.registrationId === highlightRegistrationId) - Number(a.registrationId === highlightRegistrationId) || a.position - b.position);
  if (moved.length === 0) {
    const pointsChanged = common.some((r) => before.get(r.registrationId)?.points !== r.points);
    return pointsChanged ? 'Classificação atualizada: os pontos mudaram, as posições não.' : '';
  }

  const phrases = moved.slice(0, MAX_SPOKEN).map((r) => {
    const was = before.get(r.registrationId)?.position ?? r.position;
    const who = r.registrationId === highlightRegistrationId ? `${r.name} (você)` : r.name;
    return `${who} ${r.position < was ? 'subiu' : 'caiu'} para ${r.position}º`;
  });
  const rest = moved.length - phrases.length;
  if (rest > 0) phrases.push(`e mais ${rest} ${rest === 1 ? 'mudança' : 'mudanças'}`);
  return `Classificação atualizada: ${phrases.join('; ')}.`;
}

/** "+3", "0", "−2" (com o sinal de menos tipográfico). */
export function formatDiff(value: number): string {
  if (value > 0) return `+${value}`;
  if (value < 0) return `−${Math.abs(value)}`;
  return '0';
}

/** Pontos sem zeros à toa: 10 → "10", 7.5 → "7,5". */
export function formatPoints(value: number): string {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}
