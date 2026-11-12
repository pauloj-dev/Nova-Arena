/** Textos em pt-BR dos enums do campeonato, para o organizador. */
import type { BestOf, MatchType, Qualification, Seeding, Tiebreaker } from '@nova/schemas';

export const MATCH_TYPE_LABEL: Record<MatchType, string> = {
  BATTLE_ROYALE: 'Battle Royale',
  DUEL: 'duelos 1v1',
  TEAM_VS_TEAM: 'duelos entre equipes',
};

export const BEST_OF_OPTIONS: { value: BestOf; label: string }[] = [
  { value: 1, label: 'MD1 — jogo único' },
  { value: 3, label: 'MD3 — melhor de 3' },
  { value: 5, label: 'MD5 — melhor de 5' },
  { value: 7, label: 'MD7 — melhor de 7' },
];

export const SEEDING_INFO: Record<Seeding, { label: string; description: string }> = {
  RANDOM: { label: 'Sorteio', description: 'Aleatório, com o sorteio registrado para poder ser conferido depois.' },
  RANKED: { label: 'Por ranking', description: 'Cabeças de chave pela classificação da fase anterior (ou pelo ranking, na primeira fase).' },
  MANUAL: { label: 'Manual', description: 'Você arrasta os participantes para as posições antes de confirmar a chave.' },
};

export const QUALIFICATION_LABEL: Record<Qualification['type'], string> = {
  TOP_N_PER_GROUP: 'Top N por grupo',
  TOP_N_OVERALL: 'Top N geral',
  WINNERS: 'Vencedores',
};

/** Nome do critério de desempate (PRD §10.6). `wins`/`booyahs` e `score`/`kills` são o mesmo critério, com o nome do tipo de partida. */
export function tiebreakerLabel(t: Tiebreaker): string {
  switch (t) {
    case 'points':
      return 'Pontos totais';
    case 'wins':
      return 'Vitórias';
    case 'booyahs':
      return 'Booyahs (vitórias na queda)';
    case 'kills':
      return 'Total de kills';
    case 'score':
      return 'Placar feito (coroas, gols, frames)';
    case 'avgPlacement':
      return 'Melhor colocação média';
    case 'headToHead':
      return 'Confronto direto';
    case 'scoreDiff':
      return 'Saldo (gols, coroas ou frames)';
    case 'lastDropKills':
      return 'Kills na última queda';
    case 'draw':
      return 'Sorteio (registrado na auditoria)';
  }
}

/** "Top 2 de cada grupo", "2 vencedores"… */
export function describeQualification(q: Qualification, poolUnit: 'grupo' | 'sala' = 'grupo'): string {
  const repechage = q.repechage > 0 ? ` + ${q.repechage} de repescagem` : '';
  if (q.type === 'TOP_N_PER_GROUP') return `Top ${q.n} de cada ${poolUnit}${repechage}`;
  if (q.type === 'TOP_N_OVERALL') return `Top ${q.n} da tabela geral${repechage}`;
  return `${q.n} ${q.n === 1 ? 'vencedor' : 'vencedores'}${repechage}`;
}
