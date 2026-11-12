/**
 * Texto das fases do campeonato em linguagem de jogador (página pública, aba "Visão geral").
 * Funções puras: recebem a fase e devolvem frases prontas, sem jargão de organização.
 */
import type { Qualification, Stage, StageFormat } from '@nova/schemas';

export const STAGE_FORMAT_LABELS: Record<StageFormat, string> = {
  SINGLE_ELIM: 'Mata-mata',
  DOUBLE_ELIM: 'Eliminação dupla',
  GROUPS: 'Fase de grupos',
  ROUND_ROBIN: 'Pontos corridos',
  SWISS: 'Sistema suíço',
  BATTLE_ROYALE: 'Battle Royale',
  TEAM_VS_TEAM: 'Mata-mata entre equipes',
};

export type ParticipantKind = 'SOLO' | 'TEAM';

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "jogo único" ou "melhor de 3 (MD3)". */
export function bestOfText(bestOf: number): string {
  return bestOf <= 1 ? 'jogo único' : `melhor de ${bestOf} (MD${bestOf})`;
}

/** Como a fase é jogada, uma frase por ideia. */
export function describeStageFormat(stage: Pick<Stage, 'format' | 'config'>, participant: ParticipantKind = 'TEAM'): string[] {
  const c = stage.config;
  const lobby = participant === 'TEAM' ? `até ${plural(c.lobbySize, 'equipe', 'equipes')} por sala` : `até ${plural(c.lobbySize, 'jogador', 'jogadores')} por sala`;
  const multiplier = c.lastDropMultiplier > 1 ? [`A última queda vale ×${c.lastDropMultiplier.toLocaleString('pt-BR')}.`] : [];

  switch (stage.format) {
    case 'SINGLE_ELIM':
      return ['Mata-mata: quem perde está fora.', `Cada confronto é em ${bestOfText(c.bestOf)}.`, ...(c.thirdPlace ? ['Tem disputa de 3º lugar.'] : [])];
    case 'TEAM_VS_TEAM':
      return ['Mata-mata entre equipes: quem perde está fora.', `Cada confronto é em ${bestOfText(c.bestOf)}.`, ...(c.thirdPlace ? ['Tem disputa de 3º lugar.'] : [])];
    case 'DOUBLE_ELIM':
      return [
        'Eliminação dupla: só sai quem perder duas vezes.',
        `Cada confronto é em ${bestOfText(c.bestOf)}.`,
        ...(c.grandFinalReset ? ['Se quem veio da chave dos perdedores vencer a final, joga-se mais uma partida para decidir.'] : []),
      ];
    case 'GROUPS':
      if (c.groupMode === 'BATTLE_ROYALE') {
        return [`${plural(c.groupCount, 'grupo', 'grupos')}.`, `Cada grupo joga ${plural(c.drops, 'queda', 'quedas')} de Battle Royale, com ${lobby}.`, 'Os pontos de todas as quedas se somam.', ...multiplier];
      }
      return [
        `${plural(c.groupCount, 'grupo', 'grupos')}.`,
        c.doubleRound ? 'Dentro do grupo, todos se enfrentam duas vezes (ida e volta).' : 'Dentro do grupo, todos se enfrentam uma vez.',
        `Cada confronto é em ${bestOfText(c.bestOf)}.`,
      ];
    case 'ROUND_ROBIN':
      return [c.doubleRound ? 'Pontos corridos: todos se enfrentam duas vezes (ida e volta).' : 'Pontos corridos: todos se enfrentam uma vez.', `Cada confronto é em ${bestOfText(c.bestOf)}.`, 'Quem somar mais pontos fica na frente.'];
    case 'SWISS':
      return [
        `Sistema suíço em ${plural(c.rounds, 'rodada', 'rodadas')}: a cada rodada você enfrenta alguém com campanha parecida com a sua.`,
        'Ninguém é eliminado antes da última rodada.',
        `Cada confronto é em ${bestOfText(c.bestOf)}.`,
      ];
    case 'BATTLE_ROYALE':
      return [`${plural(c.drops, 'queda', 'quedas')} de Battle Royale, com ${lobby}.`, 'Os pontos de todas as quedas se somam.', ...multiplier];
  }
}

/** Quem passa para a próxima fase. Na última fase (sem classificação), diz que ela define o campeão. */
export function describeAdvancement(qualification: Qualification | null, participant: ParticipantKind = 'TEAM'): string {
  if (!qualification) return 'Última fase: daqui sai o campeão.';
  const { type, n, repechage } = qualification;
  const best = n === 1 ? (participant === 'TEAM' ? 'a melhor equipe' : 'o melhor jogador') : participant === 'TEAM' ? `as ${n} melhores equipes` : `os ${n} melhores jogadores`;
  const verb = n === 1 ? 'Avança' : 'Avançam';
  let text: string;
  if (type === 'TOP_N_PER_GROUP') text = `${verb} ${best} de cada grupo.`;
  else if (type === 'TOP_N_OVERALL') text = `${verb} ${best} da classificação geral.`;
  else text = n === 1 ? 'Avança quem vencer a chave.' : `Avançam ${participant === 'TEAM' ? `as ${n} equipes` : `os ${n} jogadores`} que chegarem mais longe na chave.`;
  if (repechage > 0) {
    text += ` ${repechage === 1 ? 'O melhor eliminado completa' : `Os ${repechage} melhores eliminados completam`} a próxima fase.`;
  }
  return text;
}
