/**
 * Placar de um duelo digitado em formulário (envio do participante e resolução de disputa).
 * Só estatísticas brutas: os pontos são sempre calculados pelo servidor (RN-01).
 */
import type { ExtraStatField, Match, ResultEntryInput, ResultSubmission } from '@nova/schemas';
import { z } from 'zod';

const score = z.number({ error: 'Informe o placar' }).int('Use um número inteiro').min(0, 'O placar não pode ser negativo').max(999, 'Placar alto demais');
const optionalCount = z.number().int('Use um número inteiro').min(0, 'Não pode ser negativo').max(999).optional();

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
  const { a, b } = values;
  if (match.bestOf > 1) {
    const needed = Math.ceil(match.bestOf / 2);
    if (a === b) return { b: `Uma série melhor de ${match.bestOf} não termina empatada.` };
    if (Math.max(a, b) !== needed || Math.min(a, b) >= needed) return { b: `Na série melhor de ${match.bestOf}, quem vence fica com exatamente ${needed} ${needed === 1 ? 'vitória' : 'vitórias'}.` };
    return {};
  }
  if (!needsTiebreak(match, a, b)) return {};
  if (tiebreak) {
    if (values.tiebreakA === undefined || values.tiebreakB === undefined) return { tiebreakB: `Informe ${tiebreak.label.toLowerCase()} dos dois lados.` };
    if (values.tiebreakA === values.tiebreakB) return { tiebreakB: `${tiebreak.label} não pode terminar empatado: alguém venceu o desempate.` };
    return {};
  }
  return values.winner ? {} : { winner: 'Escolha quem venceu o desempate.' };
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
    return winner ? `${line} (${winner} venceu o desempate)` : `${line} (decidido no desempate)`;
  }
  return line;
}
