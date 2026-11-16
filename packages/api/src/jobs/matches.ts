/**
 * Mensagens do QStash amarradas ao horário de uma partida (issue #83): fechamento do check-in (W.O. automático na
 * #84). Cada mensagem leva o horário para o qual foi agendada. **Reagendar = cancelar e recriar**: o QStash recebe uma
 * mensagem nova (id de deduplicação com o novo horário) e a antiga, quando chegar, encontra outro horário na partida e
 * não faz nada. Assim não é preciso guardar nem apagar ids de mensagem, e repetir nunca duplica efeito.
 */
import type { Queue } from './index';

export const MATCH_CHECKIN_JOB_PATH = '/jobs/matches/check-in';

export interface MatchJobBody {
  matchId: string;
  /** Horário da partida quando a mensagem foi agendada (ISO). */
  scheduledAt: string;
}

/** A mensagem ainda vale? Só se a partida continua marcada para o mesmo horário. */
export function isCurrentSchedule(match: { scheduledAt: Date | null }, body: MatchJobBody): boolean {
  return match.scheduledAt !== null && match.scheduledAt.toISOString() === new Date(body.scheduledAt).toISOString();
}

export async function scheduleMatchJobs(queue: Queue, match: { id: string; scheduledAt: Date | null }, checkInClosesAt: string | null): Promise<void> {
  if (!match.scheduledAt) return;
  const scheduledAt = match.scheduledAt.toISOString();
  // Sem check-in, a mensagem sai no horário da partida (quem estiver presente joga; a organização decide o resto).
  const at = checkInClosesAt ? new Date(checkInClosesAt) : match.scheduledAt;
  await queue.schedule({ path: MATCH_CHECKIN_JOB_PATH, body: { matchId: match.id, scheduledAt } satisfies MatchJobBody, at, dedupId: `checkin-${match.id}-${match.scheduledAt.getTime()}` });
}
