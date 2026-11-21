/**
 * RN-09: o que acontece com os campeonatos de um organizador que perdeu o papel (revogado, suspenso, banido ou
 * conta mesclada). Porta de `releaseTournamentsOf` de `apps/web/mocks/handlers/admin-tournaments.ts`.
 *
 * - Rascunhos, finalizados, cancelados e arquivados ficam como estão.
 * - Nos campeonatos em curso (Publicado até Pausado) o co-organizador mais antigo, com a conta ativa, assume e sai da
 *   lista de equipe. Sem co-organizador, o campeonato é pausado e entra na fila "Sem responsável" (`orphan_tournaments`).
 * - Tudo auditado na mesma transação de quem chamou; avisos e tempo real saem depois do commit (`AfterCommit`).
 */
import { audited, type Tx } from '@nova/db';
import { ACTIVE_TOURNAMENT_STATUSES, type OrphanOutcome } from '@nova/schemas';
import { activeAdminIds, type AfterCommit } from './shared';

export async function releaseTournamentsOf(tx: Tx, owner: { id: string; nickname: string }, cause: string, after: AfterCommit): Promise<OrphanOutcome[]> {
  const tournaments = await tx.tournament.findMany({ where: { ownerId: owner.id, status: { in: ACTIVE_TOURNAMENT_STATUSES } }, select: { id: true, name: true, status: true }, orderBy: { createdAt: 'asc' } });
  const outcomes: OrphanOutcome[] = [];
  for (const t of tournaments) {
    const successor = await tx.tournamentStaff.findFirst({
      where: { tournamentId: t.id, role: 'CO_ORGANIZER', userId: { not: owner.id }, user: { status: 'ACTIVE' } },
      orderBy: { createdAt: 'asc' },
      select: { userId: true, user: { select: { nickname: true } } },
    });
    if (successor) {
      await tx.tournament.update({ where: { id: t.id }, data: { ownerId: successor.userId } });
      // Quem virou responsável deixa de constar como co-organizador.
      await tx.tournamentStaff.delete({ where: { tournamentId_userId: { tournamentId: t.id, userId: successor.userId } } });
      await tx.orphanTournament.deleteMany({ where: { tournamentId: t.id } });
      await audited(tx, {
        action: 'TOURNAMENT_OWNER_CHANGED',
        entityType: 'Tournament',
        entityId: t.id,
        entityLabel: t.name,
        tournamentId: t.id,
        before: { ownerId: owner.id, responsavel: owner.nickname },
        after: { ownerId: successor.userId, responsavel: successor.user.nickname },
        reason: `${cause}. O co-organizador mais antigo assumiu (RN-09).`,
      });
      after.notify([successor.userId], {
        type: 'ANNOUNCEMENT',
        title: 'Você agora é responsável por um campeonato',
        body: `${t.name}: ${owner.nickname} deixou a organização e você, como co-organizador mais antigo, assumiu.`,
        link: `/organizador/campeonatos/${t.id}`,
      });
      outcomes.push({ id: t.id, name: t.name, outcome: 'TRANSFERRED', newOwnerNickname: successor.user.nickname });
    } else {
      await tx.tournament.update({ where: { id: t.id }, data: { status: 'PAUSED', statusReason: `${cause}: campeonato sem responsável.` } });
      await tx.orphanTournament.upsert({
        where: { tournamentId: t.id },
        create: { tournamentId: t.id, previousOwnerId: owner.id, previousStatus: t.status, cause },
        update: { previousOwnerId: owner.id, cause },
      });
      await audited(tx, {
        action: 'TOURNAMENT_STATUS_CHANGED',
        entityType: 'Tournament',
        entityId: t.id,
        entityLabel: t.name,
        tournamentId: t.id,
        before: { status: t.status, semResponsavel: false },
        after: { status: 'PAUSED', semResponsavel: true },
        reason: `${cause}. Sem co-organizador: campeonato pausado e enviado para a fila "Sem responsável" (RN-09).`,
      });
      outcomes.push({ id: t.id, name: t.name, outcome: 'PAUSED', newOwnerNickname: null });
    }
    after.publish(`tournament:${t.id}`, { type: 'tournament.updated', tournamentId: t.id });
  }
  if (outcomes.length > 0) {
    const paused = outcomes.filter((o) => o.outcome === 'PAUSED').length;
    after.notify(await activeAdminIds(tx), {
      type: 'ANNOUNCEMENT',
      title: paused > 0 ? `${paused} campeonato(s) sem responsável` : 'Responsável de campeonato trocado',
      body: `${owner.nickname} deixou de organizar ${outcomes.length} campeonato(s) em curso: ${outcomes.map((o) => (o.outcome === 'PAUSED' ? `${o.name} (pausado)` : `${o.name} (assumido por ${o.newOwnerNickname})`)).join('; ')}.`,
      link: paused > 0 ? '/admin/campeonatos?fila=sem-responsavel' : '/admin/campeonatos',
    });
  }
  return outcomes;
}
