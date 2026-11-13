/**
 * Módulo `admin-moderation` da API simulada (ADM-07): fila de denúncias e disputas escaladas.
 *
 * As denúncias são gravadas pelo módulo `reports` e as disputas pelo módulo `submissions`;
 * aqui o Admin lê e atualiza as mesmas coleções. As ações rápidas (advertir, suspender, banir)
 * usam `POST /admin/users/:id/sanctions` com `reportId`, que já fecha a denúncia.
 */
import { http, type HttpHandler } from 'msw';
import { DisputeStatus, HandleReportInput, ReportStatus, type AdminReport } from '@nova/schemas';
import { audit } from '../audit';
import { nowIso, save } from '../db';
import { badRequest, body, handle, json, notFound, paginateNumbered, param, query, url } from '../http';
import { notify } from '../notify';
import { findUser } from '../views';
import { adminOnly } from './admin-settings';
import { expireSuspensions } from './admin-users';
import { reports, toReport, type DbReport } from './reports';
import { disputes, toDispute } from './submissions';

export const moduleName = 'admin-moderation';

const STATUS_ORDER: Record<AdminReport['status'], number> = { OPEN: 0, IN_REVIEW: 1, ACTIONED: 2, DISMISSED: 2 };

function toAdminReport(r: DbReport): AdminReport {
  const owner = findUser(r.targetOwnerUserId ?? (r.targetType === 'USER' ? r.targetId : null));
  return { ...toReport(r), reporterId: r.reporterId ?? null, targetUserId: owner?.id ?? null, targetUserNickname: owner?.nickname ?? null, targetUserStatus: owner?.status ?? null };
}

export const openReportsCount = () => reports().filter((r) => r.status === 'OPEN' || r.status === 'IN_REVIEW').length;
export const openDisputesCount = () => disputes().filter((d) => d.status !== 'RESOLVED').length;

export const handlers: HttpHandler[] = [
  http.get(
    url('/admin/reports'),
    handle(({ request }) => {
      adminOnly();
      expireSuspensions();
      const q = query(request);
      const status = ReportStatus.safeParse(q.get('status'));
      const targetUserId = q.get('targetUserId');
      const rows = reports()
        .filter((r) => !status.success || r.status === status.data)
        .map(toAdminReport)
        .filter((r) => !targetUserId || r.targetUserId === targetUserId)
        // Fila: abertas primeiro, da mais antiga para a mais nova; tratadas depois, da mais recente para a mais antiga.
        .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (STATUS_ORDER[a.status] < 2 ? a.createdAt.localeCompare(b.createdAt) : b.updatedAt.localeCompare(a.updatedAt)));
      return json(paginateNumbered(rows, q.get('page')));
    }),
  ),

  http.patch(
    url('/admin/reports/:id'),
    handle(async ({ request, params }) => {
      const actor = adminOnly();
      const record = reports().find((r) => r.id === param(params, 'id'));
      if (!record) throw notFound('Denúncia');
      const input = await body(request, HandleReportInput);
      const resolution = input.resolution?.trim() || null;
      const closing = input.status === 'ACTIONED' || input.status === 'DISMISSED';
      // Quem denunciou lê a resposta: fechar a denúncia sem explicar não vale.
      if (closing && (!resolution || resolution.length < 5)) throw badRequest('Confira os campos destacados.', 'VALIDATION', { resolution: 'Explique a decisão (pelo menos 5 caracteres)' });

      const before = { status: record.status };
      record.status = input.status;
      if (resolution) record.resolution = resolution;
      record.handledByNickname = actor.nickname;
      record.updatedAt = nowIso();
      save();
      audit(actor, { action: 'REPORT_HANDLED', entityType: 'Report', entityId: record.id, entityLabel: record.targetLabel, before, after: { status: record.status }, reason: resolution });
      if (closing && record.reporterId) {
        notify(
          [record.reporterId],
          'SANCTION',
          input.status === 'ACTIONED' ? 'Sua denúncia foi analisada' : 'Sua denúncia foi considerada improcedente',
          `${record.targetLabel}: ${resolution}`,
          null,
        );
      }
      return json(toAdminReport(record));
    }),
  ),

  /** Disputas que o organizador escalou para a administração (padrão) ou em outro estado. */
  http.get(
    url('/admin/disputes'),
    handle(({ request }) => {
      adminOnly();
      const wanted = DisputeStatus.safeParse(query(request).get('status') ?? 'ESCALATED');
      const rows = disputes()
        .filter((d) => !wanted.success || d.status === wanted.data)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map(toDispute);
      return json(rows);
    }),
  ),
];
