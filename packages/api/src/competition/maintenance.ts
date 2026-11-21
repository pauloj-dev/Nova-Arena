/**
 * Manutenção da chave fora do lançamento de resultado (issue #100, RN-06, RN-07).
 *
 * Substituição por alguém da lista de espera vale até a chave ser confirmada: se a fase já tem prévia gerada, o
 * substituto ocupa o mesmo lugar do substituído (mesmo grupo, mesma vaga, mesma seed) — a organização não precisa
 * regerar a chave. Com a chave confirmada não há substituição (a rota de inscrições já recusa).
 */
import type { Prisma } from '@nova/db';
import type { StageStructure } from '@nova/engine';
import { projectRun, readRun, snapshotOf } from './run';

export async function replaceEntrantInPreview(tx: Prisma.TransactionClient, tournamentId: string, fromId: string, toId: string, toName: string): Promise<string[]> {
  const stages = await tx.stage.findMany({ where: { tournamentId, confirmedAt: null }, select: { id: true, engineSnapshot: true, confirmedAt: true, unlocked: true } });
  const changed: string[] = [];
  for (const stage of stages) {
    const run = readRun(stage);
    if (!run || !run.structure.entrants.some((e) => e.id === fromId)) continue;
    // Ids são UUIDs: trocar o texto exato troca a pessoa em entrants, grupos e vagas, sem tocar em mais nada.
    const structure = JSON.parse(JSON.stringify(run.structure).split(`"${fromId}"`).join(`"${toId}"`)) as StageStructure;
    structure.entrants = structure.entrants.map((e) => (e.id === toId ? { ...e, name: toName } : e));
    await tx.stage.update({ where: { id: stage.id }, data: { engineSnapshot: snapshotOf(structure, run.state) } });
    await projectRun(tx, stage.id, { structure, state: run.state }, { previous: run });
    changed.push(stage.id);
  }
  return changed;
}
