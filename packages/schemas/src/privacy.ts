/**
 * LGPD (issue #115, RNF-10): exportação dos dados pessoais e exclusão da conta com anonimização
 * (docs/modelo-de-dados.md, "Exclusão de conta (LGPD) × histórico imutável").
 */
import { z } from 'zod';
import { Id, IsoDateTime } from './common';

export const DataExportStatus = z.enum(['PENDING', 'READY', 'FAILED']);
export type DataExportStatus = z.infer<typeof DataExportStatus>;

/** Exportação gerada em job (conta com muito histórico). */
export const DataExportJob = z.object({
  id: Id,
  status: DataExportStatus,
  createdAt: IsoDateTime,
  readyAt: IsoDateTime.nullable(),
  expiresAt: IsoDateTime,
  /** Endereço do download (só o dono baixa), quando pronto. */
  downloadUrl: z.string().nullable(),
  size: z.number().int().nullable(),
});
export type DataExportJob = z.infer<typeof DataExportJob>;

/** `POST /me/export` com arquivo grande: o job foi agendado e a pessoa é avisada quando ficar pronto. */
export const DataExportQueued = z.object({ queued: z.literal(true), export: DataExportJob });
export type DataExportQueued = z.infer<typeof DataExportQueued>;

/** Formato do arquivo exportado (versão em `format`). */
export const DATA_EXPORT_FORMAT = 'nova-arena/dados-pessoais@1';

/**
 * Arquivo exportado. As seções seguem as tabelas com dado da pessoa; outras pessoas aparecem só pelo apelido.
 * Segredos (hash de senha, segredo do 2FA, tokens) nunca entram.
 */
export const PersonalDataExport = z.object({
  format: z.literal(DATA_EXPORT_FORMAT),
  generatedAt: IsoDateTime,
  account: z.record(z.string(), z.unknown()),
  sections: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
});
export type PersonalDataExport = z.infer<typeof PersonalDataExport>;

/** Resposta de `POST /me/export`: o arquivo pronto ou o aviso de que vai para um job. */
export const DataExportResponse = z.union([PersonalDataExport, DataExportQueued]);
export type DataExportResponse = z.infer<typeof DataExportResponse>;

/** Frase que a pessoa digita para confirmar a exclusão. */
export const DELETE_ACCOUNT_PHRASE = 'EXCLUIR MINHA CONTA';

export const DeleteAccountInput = z.object({
  /** Obrigatória para quem tem senha. Conta só com Google/Discord confirma só com a frase. */
  password: z.string().optional(),
  confirmation: z.string().refine((v) => v.trim().toUpperCase() === DELETE_ACCOUNT_PHRASE, `Digite "${DELETE_ACCOUNT_PHRASE}" para confirmar`),
});
export type DeleteAccountInput = z.infer<typeof DeleteAccountInput>;

/** O que impede a exclusão agora (a tela mostra antes de pedir a confirmação). */
export const DeletionBlocker = z.object({
  code: z.enum(['OWNS_ACTIVE_TOURNAMENTS', 'ACTIVE_REGISTRATIONS', 'LAST_SUPER_ADMIN']),
  message: z.string(),
  /** O que resolver (ex.: os campeonatos ativos), com link quando houver. */
  items: z.array(z.object({ label: z.string(), href: z.string().nullable() })),
});
export type DeletionBlocker = z.infer<typeof DeletionBlocker>;

/** `GET /me/deletion`: dá para excluir agora? */
export const DeletionCheck = z.object({ canDelete: z.boolean(), blockers: z.array(DeletionBlocker), hasPassword: z.boolean() });
export type DeletionCheck = z.infer<typeof DeletionCheck>;

/** Consentimento de medição (banner de cookies): guardado só no navegador. */
export const CookieConsent = z.object({
  /** Versão do texto do banner: mudou → o banner volta. */
  version: z.literal(1),
  /** Medição de uso anônima (Vercel Analytics e Speed Insights, sem cookies). Padrão: desligada. */
  analytics: z.boolean(),
  decidedAt: IsoDateTime,
});
export type CookieConsent = z.infer<typeof CookieConsent>;

/**
 * Apelido de uma conta excluída: `removido-<8 hex>` (17 caracteres: cabe no limite de 20 do apelido, então
 * inscrições, chaves e tabelas antigas continuam válidas pelo contrato).
 */
export const DELETED_NICKNAME_PREFIX = 'removido-';
export const isDeletedNickname = (nickname: string) => /^removido-[0-9a-f]{8}$/.test(nickname);
