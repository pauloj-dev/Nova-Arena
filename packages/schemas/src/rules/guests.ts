/**
 * Elenco sem conta (RN-18) como função pura: a mesma conferência na prévia da planilha, no formulário, na API
 * simulada e na API real. Em arquivo próprio para não entrar no JavaScript de quem só usa as regras de inscrição.
 */
import type { ModeSize } from './registrations';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export interface GuestSlot {
  name: string;
  gameId?: string | null;
  isSub?: boolean;
}

/** Como dois nomes (ou IDs) são comparados: sem espaços nas pontas e sem diferença de maiúsculas. */
export const guestKey = (value: string) => value.trim().toLowerCase();

/**
 * Confere o elenco sem conta de uma inscrição contra o modo do campeonato: titulares até `teamSize`, reservas até
 * `maxSubs`, sem nome nem ID de jogo repetido. Devolve a mensagem do primeiro problema, ou `null` se está certo.
 * A mesma função vale na prévia da planilha, no formulário, na API simulada e na API real.
 */
export function guestRosterProblem(guests: GuestSlot[], mode: ModeSize): string | null {
  const starters = guests.filter((g) => !g.isSub).length;
  const subs = guests.length - starters;
  if (starters > mode.teamSize) return `Este modo tem ${plural(mode.teamSize, 'titular', 'titulares')} por squad: o elenco ficaria com ${starters}.`;
  if (subs > mode.maxSubs) return mode.maxSubs === 0 ? 'Este modo não tem reservas.' : `Este modo aceita ${plural(mode.maxSubs, 'reserva', 'reservas')} por squad: o elenco ficaria com ${subs}.`;
  const names = new Set<string>();
  const ids = new Set<string>();
  for (const g of guests) {
    const name = guestKey(g.name);
    if (name === '') return 'Há um jogador sem nome no elenco.';
    if (names.has(name)) return `O jogador "${g.name.trim()}" aparece duas vezes no elenco.`;
    names.add(name);
    const id = guestKey(g.gameId ?? '');
    if (id === '') continue;
    if (ids.has(id)) return `O ID no jogo "${(g.gameId ?? '').trim()}" aparece duas vezes no elenco.`;
    ids.add(id);
  }
  return null;
}
