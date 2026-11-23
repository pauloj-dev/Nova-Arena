/**
 * Texto das fases do campeonato em linguagem de jogador (página pública, aba "Visão geral").
 * Funções puras: recebem a fase e devolvem frases prontas, sem jargão de organização.
 */
import { StageFormat, type Qualification, type Stage } from '@nova/schemas';
import { getFormat, getT } from '@/shared/i18n/core';
import { messages } from './messages';

/** Nome do formato da fase ("Mata-mata", "Fase de grupos"…). */
export function stageFormatLabel(format: StageFormat): string {
  return getT(messages, 'stageText')('formato', { formato: format });
}

/** O mesmo texto de `stageFormatLabel`, como mapa (cada rótulo é lido do catálogo na hora do acesso). */
export const STAGE_FORMAT_LABELS: Readonly<Record<StageFormat, string>> = Object.defineProperties(
  {} as Record<StageFormat, string>,
  Object.fromEntries(StageFormat.options.map((format) => [format, { enumerable: true, get: () => stageFormatLabel(format) }])),
);

export type ParticipantKind = 'SOLO' | 'TEAM';

/** "jogo único" ou "melhor de 3 (MD3)". */
export function bestOfText(bestOf: number): string {
  const t = getT(messages, 'stageText');
  return bestOf <= 1 ? t('jogoUnico') : t('melhorDe', { bestOf });
}

/** Como a fase é jogada, uma frase por ideia. */
export function describeStageFormat(stage: Pick<Stage, 'format' | 'config'>, participant: ParticipantKind = 'TEAM'): string[] {
  const t = getT(messages, 'stageText');
  const c = stage.config;
  const lobby = t('lobby', { n: c.lobbySize, participante: participant });
  const multiplier = c.lastDropMultiplier > 1 ? [t('multiplicador', { multiplicador: getFormat().number(c.lastDropMultiplier) })] : [];
  const match = t('confronto', { formato: bestOfText(c.bestOf) });

  switch (stage.format) {
    case 'SINGLE_ELIM':
      return [t('mataMata'), match, ...(c.thirdPlace ? [t('terceiroLugar')] : [])];
    case 'TEAM_VS_TEAM':
      return [t('mataMataEquipes'), match, ...(c.thirdPlace ? [t('terceiroLugar')] : [])];
    case 'DOUBLE_ELIM':
      return [t('eliminacaoDupla'), match, ...(c.grandFinalReset ? [t('finalComReset')] : [])];
    case 'GROUPS':
      if (c.groupMode === 'BATTLE_ROYALE') {
        return [t('grupos', { n: c.groupCount }), t('grupoBattleRoyale', { n: c.drops, lobby }), t('pontosSomam'), ...multiplier];
      }
      return [t('grupos', { n: c.groupCount }), c.doubleRound ? t('grupoIdaEVolta') : t('grupoUmaVez'), match];
    case 'ROUND_ROBIN':
      return [c.doubleRound ? t('pontosCorridosIdaEVolta') : t('pontosCorridosUmaVez'), match, t('quemSomarMais')];
    case 'SWISS':
      return [t('suico', { n: c.rounds }), t('ninguemEliminado'), match];
    case 'BATTLE_ROYALE':
      return [t('battleRoyale', { n: c.drops, lobby }), t('pontosSomam'), ...multiplier];
  }
}

/** Quem passa para a próxima fase. Na última fase (sem classificação), diz que ela define o campeão. */
export function describeAdvancement(qualification: Qualification | null, participant: ParticipantKind = 'TEAM'): string {
  const t = getT(messages, 'stageText');
  if (!qualification) return t('ultimaFase');
  const { type, n, repechage } = qualification;
  const melhores = t('melhores', { n, participante: participant });
  let text: string;
  if (type === 'TOP_N_PER_GROUP') text = t('avancamPorGrupo', { n, melhores });
  else if (type === 'TOP_N_OVERALL') text = t('avancamGeral', { n, melhores });
  else text = n === 1 ? t('avancaQuemVencer') : t('avancamDaChave', { n, participante: participant });
  // Duas frases independentes, uma depois da outra.
  if (repechage > 0) text += ` ${t('repescagem', { n: repechage })}`;
  return text;
}
