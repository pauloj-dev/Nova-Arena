/**
 * Placar de um duelo digitado em formulário (envio do participante e resolução de disputa).
 * Só estatísticas brutas: os pontos são sempre calculados pelo servidor (RN-01).
 */
import type { ExtraStatField, Match, ResultEntryInput, ResultSubmission } from '@nova/schemas';
import { z } from 'zod';
import { getT } from '@/shared/i18n/core';
import { messages } from './messages';

/** Mensagem de validação lida na hora do erro (no idioma de então), não ao carregar o módulo. */
const msg = (key: 'informePlacar' | 'numeroInteiro' | 'placarNegativo' | 'placarAlto' | 'naoPodeNegativo') => () => getT(messages, 'scoreForm')(key);

const score = z.number({ error: msg('informePlacar') }).int({ error: msg('numeroInteiro') }).min(0, { error: msg('placarNegativo') }).max(999, { error: msg('placarAlto') });
const optionalCount = z.number().int({ error: msg('numeroInteiro') }).min(0, { error: msg('naoPodeNegativo') }).max(999).optional();

/** Campos do formulário, na ordem das vagas da partida (A x B). */
export const ScoreFormSchema = z.object({
  a: score,
  b: score,
  /** Campo de desempate do jogo (ex.: pênaltis), quando o placar empata em mata-mata. */
  tiebreakA: optionalCount,
  tiebreakB: optionalCount,
  /** Vencedor do desempate, quando o jogo não tem campo próprio. */
  winner: z.string().optional(),
});
export type ScoreFormValues = z.infer<typeof ScoreFormSchema>;
export type ScoreField = keyof ScoreFormValues;

export interface Side {
  registrationId: string;
  name: string;
}

/** Os dois lados do duelo, na ordem das vagas. Nulo se a partida ainda não tem os dois definidos. */
export function sidesOf(match: Pick<Match, 'participants'>): [Side, Side] | null {
  const [a, b] = match.participants;
  if (!a?.registrationId || !b?.registrationId) return null;
  return [
    { registrationId: a.registrationId, name: a.name },
    { registrationId: b.registrationId, name: b.name },
  ];
}

/** Empate em partida eliminatória de jogo único pede desempate (RN-14). */
export function needsTiebreak(match: Pick<Match, 'bracket' | 'bestOf'>, a: number | undefined, b: number | undefined): boolean {
  return match.bracket !== null && match.bestOf === 1 && typeof a === 'number' && typeof b === 'number' && !Number.isNaN(a) && a === b;
}

/** Regras do placar que dependem da partida: série melhor de N e desempate. Devolve o erro por campo. */
export function scoreProblems(match: Pick<Match, 'bracket' | 'bestOf'>, values: ScoreFormValues, tiebreak: ExtraStatField | undefined): Partial<Record<ScoreField, string>> {
  const t = getT(messages, 'scoreForm');
  const { a, b } = values;
  if (match.bestOf > 1) {
    const needed = Math.ceil(match.bestOf / 2);
    if (a === b) return { b: t('serieEmpatada', { bestOf: match.bestOf }) };
    if (Math.max(a, b) !== needed || Math.min(a, b) >= needed) return { b: t('serieVitorias', { bestOf: match.bestOf, needed }) };
    return {};
  }
  if (!needsTiebreak(match, a, b)) return {};
  if (tiebreak) {
    if (values.tiebreakA === undefined || values.tiebreakB === undefined) return { tiebreakB: t('informeDesempate', { campo: tiebreak.label.toLowerCase() }) };
    if (values.tiebreakA === values.tiebreakB) return { tiebreakB: t('desempateEmpatado', { campo: tiebreak.label }) };
    return {};
  }
  return values.winner ? {} : { winner: t('escolhaVencedor') };
}

/** Converte o formulário nas estatísticas brutas que a API recebe. */
export function toResultInput(match: Pick<Match, 'bracket' | 'bestOf'>, sides: [Side, Side], values: ScoreFormValues, tiebreak: ExtraStatField | undefined): { entries: ResultEntryInput[]; winnerRegistrationId?: string } {
  const tied = needsTiebreak(match, values.a, values.b);
  const stat = (value: number | undefined) => (tied && tiebreak && value !== undefined ? { stats: { [tiebreak.key]: value } } : {});
  return {
    entries: [
      { registrationId: sides[0].registrationId, score: values.a, ...stat(values.tiebreakA) },
      { registrationId: sides[1].registrationId, score: values.b, ...stat(values.tiebreakB) },
    ],
    ...(tied && !tiebreak && values.winner ? { winnerRegistrationId: values.winner } : {}),
  };
}

/** "Bianca 2 x 1 Caio" a partir do envio. Sem os nomes (partida ainda carregando), fica "2 x 1". */
export function scoreLine(submission: Pick<ResultSubmission, 'entries' | 'winnerRegistrationId'>, match?: Pick<Match, 'participants'> | null): string {
  const name = (registrationId: string) => match?.participants.find((p) => p.registrationId === registrationId)?.name;
  const [a, b] = submission.entries;
  if (!a || !b) return '';
  const left = name(a.registrationId);
  const right = name(b.registrationId);
  const line = `${left ? `${left} ` : ''}${a.score ?? 0} x ${b.score ?? 0}${right ? ` ${right}` : ''}`;
  // Empate com vencedor definido no desempate.
  if ((a.score ?? 0) === (b.score ?? 0) && submission.winnerRegistrationId) {
    const winner = name(submission.winnerRegistrationId);
    const t = getT(messages, 'scoreForm');
    return winner ? t('venceuDesempate', { linha: line, vencedor: winner }) : t('decididoDesempate', { linha: line });
  }
  return line;
}
