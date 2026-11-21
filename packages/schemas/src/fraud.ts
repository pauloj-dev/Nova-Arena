/**
 * Antifraude (issue #114, PRD §16.5 e §22 R1/R4): alertas para o painel de moderação.
 *
 * - `MULTI_ACCOUNT_IP` / `MULTI_ACCOUNT_DEVICE`: várias contas entrando do mesmo IP ou do mesmo aparelho.
 * - `DUPLICATE_GAME_ID`: o mesmo ID de jogo em contas diferentes.
 * - `MASS_ADMIN_ACTION`: muitas ações administrativas do mesmo Admin em pouco tempo (avisa o Super Admin).
 */
import { z } from 'zod';
import { Id, IsoDateTime } from './common';
import { UserStatus } from './user';

export const FraudAlertKind = z.enum(['MULTI_ACCOUNT_IP', 'MULTI_ACCOUNT_DEVICE', 'DUPLICATE_GAME_ID', 'MASS_ADMIN_ACTION']);
export type FraudAlertKind = z.infer<typeof FraudAlertKind>;

export const FraudAlertStatus = z.enum(['OPEN', 'ACTIONED', 'DISMISSED']);
export type FraudAlertStatus = z.infer<typeof FraudAlertStatus>;

export const FraudSeverity = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export type FraudSeverity = z.infer<typeof FraudSeverity>;

export const FRAUD_ALERT_LABELS: Record<FraudAlertKind, string> = {
  MULTI_ACCOUNT_IP: 'Várias contas no mesmo IP',
  MULTI_ACCOUNT_DEVICE: 'Várias contas no mesmo aparelho',
  DUPLICATE_GAME_ID: 'ID de jogo repetido em contas diferentes',
  MASS_ADMIN_ACTION: 'Ações administrativas em massa',
};

/** Tipo de ação administrativa vigiada no alerta de ações em massa. */
export const MassActionKind = z.enum(['BAN', 'SANCTION', 'ROLE_CHANGE', 'TOURNAMENT_CANCEL']);
export type MassActionKind = z.infer<typeof MassActionKind>;

export const MASS_ACTION_LABELS: Record<MassActionKind, string> = {
  BAN: 'banimentos',
  SANCTION: 'sanções',
  ROLE_CHANGE: 'mudanças de papel',
  TOURNAMENT_CANCEL: 'cancelamentos de campeonato',
};

/**
 * Limites dos alertas (mesmos na API real e na simulada). Celular no Brasil costuma sair por CGNAT, com muita gente
 * no mesmo IP: o limite por IP é alto e a janela, curta; o do aparelho é mais sensível.
 */
export const FRAUD_THRESHOLDS = {
  ipAccounts: 5,
  ipWindowHours: 24,
  deviceAccounts: 3,
  deviceWindowDays: 30,
  /** Ações do mesmo Admin, do mesmo tipo, dentro da janela. Critério de aceite: 10 banimentos em 1 min. */
  massActions: { BAN: 10, SANCTION: 15, ROLE_CHANGE: 10, TOURNAMENT_CANCEL: 5 } satisfies Record<MassActionKind, number>,
  massWindowSeconds: 60,
  /** Alerta repetido dentro deste intervalo soma no mesmo alerta aberto em vez de abrir outro. */
  dedupeHours: 24,
} as const;

export const FraudAlertUser = z.object({ id: Id, nickname: z.string(), status: UserStatus });
export type FraudAlertUser = z.infer<typeof FraudAlertUser>;

export const FraudAlert = z.object({
  id: Id,
  kind: FraudAlertKind,
  status: FraudAlertStatus,
  severity: FraudSeverity,
  /** Resumo legível, já pronto para a tela (ex.: "4 contas entraram do mesmo IP em 24 h"). */
  summary: z.string(),
  users: z.array(FraudAlertUser),
  /** Admin que disparou o alerta de ações em massa. */
  actor: FraudAlertUser.nullable(),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  occurrences: z.number().int(),
  firstSeenAt: IsoDateTime,
  lastSeenAt: IsoDateTime,
  reviewedByNickname: z.string().nullable(),
  reviewedAt: IsoDateTime.nullable(),
  resolution: z.string().nullable(),
});
export type FraudAlert = z.infer<typeof FraudAlert>;

export const FraudAlertPage = z.object({
  items: z.array(FraudAlert),
  page: z.number().int(),
  pageCount: z.number().int(),
  total: z.number().int(),
  /** Alertas abertos (para o contador da aba), independentemente do filtro. */
  openCount: z.number().int(),
});
export type FraudAlertPage = z.infer<typeof FraudAlertPage>;

export const ReviewFraudAlertInput = z.object({
  status: z.enum(['ACTIONED', 'DISMISSED']),
  resolution: z.string().trim().min(5, 'Explique a decisão (pelo menos 5 caracteres)').max(500),
});
export type ReviewFraudAlertInput = z.infer<typeof ReviewFraudAlertInput>;

/** Mostra só o começo do IP (LGPD: o Admin não precisa do endereço inteiro para agir). */
export function maskAlertIp(ip: string): string {
  if (ip.includes(':')) return `${ip.split(':').slice(0, 3).join(':')}:…`;
  const parts = ip.split('.');
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.x` : ip;
}
