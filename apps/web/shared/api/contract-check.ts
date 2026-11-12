/**
 * Garantia em tempo de compilação: os contratos de `@nova/schemas` e os tipos do motor
 * (`@nova/engine`) descrevem as mesmas regras de pontuação. Se um lado mudar sem o outro,
 * o `typecheck` quebra aqui.
 */
import type { Rule, Tiebreaker as EngineTiebreaker } from '@nova/engine';
import type { ScoringRule, Tiebreaker } from '@nova/schemas';

type Assert<T extends true> = T;
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export type RulesMatch = Assert<Mutual<ScoringRule, Rule>>;
export type TiebreakersMatch = Assert<Mutual<Tiebreaker, EngineTiebreaker>>;
