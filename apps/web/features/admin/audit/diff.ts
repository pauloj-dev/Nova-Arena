/**
 * Comparação campo a campo do "antes" e do "depois" de um registro de auditoria.
 * Função pura: a tela (`AuditDiff`) só desenha o resultado.
 */
import { formatDateTime } from '@/shared/lib/datetime';

export type AuditValues = Record<string, unknown> | null | undefined;

export interface DiffRow {
  key: string;
  label: string;
  before: string;
  after: string;
  /** `added`: só existe no depois · `removed`: só existia antes · `changed` · `same`. */
  kind: 'added' | 'removed' | 'changed' | 'same';
}

const FIELD_LABELS: Record<string, string> = {
  status: 'Status',
  featured: 'Destaque na home',
  ownerId: 'ID do responsável',
  responsavel: 'Responsável',
  semResponsavel: 'Sem responsável',
  papeis: 'Papéis',
  papel: 'Papel',
  papelRemovido: 'Papel removido',
  limite: 'Limite de campeonatos',
  simultaneos: 'Campeonatos simultâneos',
  jogos: 'Jogos permitidos',
  verificado: 'Selo verificado',
  sancao: 'Sanção',
  ate: 'Até',
  denuncia: 'Denúncia',
  situacao: 'Situação',
  pedido: 'Pedido',
  estado: 'Estado',
  usos: 'Usos',
  validade: 'Validade',
  email: 'E-mail',
  enabled: 'Ligado',
  active: 'Ativo',
  tipo: 'Tipo',
  publico: 'Público',
  destinatarios: 'Destinatários',
  inicio: 'Início',
  fim: 'Fim',
  twoFactorEnabled: 'Verificação em duas etapas',
  siteName: 'Nome do site',
  logoUrl: 'Logo',
  homeBanners: 'Banners da home',
  termsHtml: 'Termos de uso',
  privacyHtml: 'Política de privacidade',
  supportEmail: 'E-mail de suporte',
  minAge: 'Idade mínima',
  requireApprovalForSeniorAdminRemoval: 'Aprovação para remover Admin mais antigo',
  origem: 'Conta de origem',
  origemId: 'ID da origem',
  origemStatus: 'Status da origem',
  origemPapeis: 'Papéis da origem',
  destino: 'Conta de destino',
  inscricoesTransferidas: 'Inscrições transferidas',
  squadsTransferidos: 'Squads transferidos',
  idsDeJogoTransferidos: 'IDs de jogo transferidos',
  linkEnviadoPara: 'Link enviado para',
  seed: 'Seed do sorteio',
  trocou: 'Trocou de lugar',
  rodada: 'Rodada',
};

/** Valores "de máquina" que aparecem nos registros, traduzidos para a tela. */
const VALUE_LABELS: Record<string, string> = {
  ACTIVE: 'Ativo',
  SUSPENDED: 'Suspenso',
  BANNED: 'Banido',
  MERGED: 'Mesclado',
  DELETED: 'Excluído',
  DRAFT: 'Rascunho',
  PUBLISHED: 'Publicado',
  REGISTRATION_OPEN: 'Inscrições abertas',
  REGISTRATION_CLOSED: 'Inscrições encerradas',
  CHECK_IN: 'Check-in',
  IN_PROGRESS: 'Em andamento',
  PAUSED: 'Pausado',
  FINISHED: 'Finalizado',
  ARCHIVED: 'Arquivado',
  CANCELLED: 'Cancelado',
  PENDING: 'Pendente',
  APPROVED: 'Aprovado',
  REJECTED: 'Recusado',
  OPEN: 'Aberta',
  IN_REVIEW: 'Em análise',
  ACTIONED: 'Tratada',
  DISMISSED: 'Improcedente',
  VALID: 'Válido',
  EXPIRED: 'Expirado',
  REVOKED: 'Revogado',
  EXHAUSTED: 'Esgotado',
  WARNING: 'Advertência',
  SUSPENSION: 'Suspensão',
  BAN: 'Banimento',
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Administrador',
  ORGANIZER: 'Organizador',
  PARTICIPANT: 'Participante',
  BANNER: 'Banner',
  NOTIFICATION: 'Notificação',
  MAINTENANCE: 'Manutenção',
  '1h': '1 hora',
  '24h': '24 horas',
  '7d': '7 dias',
};

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const EMPTY = '—';

/** "maxActiveTournaments" → "Max active tournaments" (para campos que ainda não têm rótulo). */
export function fieldLabel(key: string): string {
  const known = FIELD_LABELS[key];
  if (known) return known;
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Valor legível: sim/não, datas no fuso da pessoa, listas separadas por vírgula. */
export function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return EMPTY;
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (typeof value === 'number') return new Intl.NumberFormat('pt-BR').format(value);
  if (typeof value === 'string') {
    if (ISO_DATE_TIME.test(value)) return formatDateTime(value);
    return VALUE_LABELS[value] ?? value;
  }
  if (Array.isArray(value)) return value.length === 0 ? EMPTY : value.map(formatAuditValue).join(', ');
  return Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => `${fieldLabel(k)}: ${formatAuditValue(v)}`)
    .join('; ');
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Uma linha por campo que aparece no antes ou no depois, na ordem em que aparecem.
 * Os campos alterados vêm primeiro: é o que quem audita procura.
 */
export function diffAudit(before: AuditValues, after: AuditValues): DiffRow[] {
  const b = before ?? {};
  const a = after ?? {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  const rows = keys.map((key): DiffRow => {
    const inBefore = key in b && b[key] !== undefined;
    const inAfter = key in a && a[key] !== undefined;
    const kind: DiffRow['kind'] = !inBefore ? 'added' : !inAfter ? 'removed' : same(b[key], a[key]) ? 'same' : 'changed';
    return { key, label: fieldLabel(key), before: inBefore ? formatAuditValue(b[key]) : EMPTY, after: inAfter ? formatAuditValue(a[key]) : EMPTY, kind };
  });
  return [...rows.filter((r) => r.kind !== 'same'), ...rows.filter((r) => r.kind === 'same')];
}
