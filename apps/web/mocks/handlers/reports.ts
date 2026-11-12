/**
 * Módulo `reports` da API simulada: denúncias de usuário, squad, partida ou resultado (PAR-12, F2.9).
 * A fila de moderação do Admin lê e atualiza a mesma coleção (`reports()`).
 */
import { http, type HttpHandler } from 'msw';
import { CreateReportInput, type Report } from '@nova/schemas';
import { findStage, getRun, splitMatchId } from '../competition';
import { collection, db, nowIso, save, uid, type DbUser } from '../db';
import { badRequest, body, conflict, handle, HttpProblem, json, notFound, requireUser, url } from '../http';
import { toRegistration } from '../views';
import { submissions } from './submissions';

export const moduleName = 'reports';

/** Máximo de denúncias em aberto do mesmo autor para o mesmo alvo. */
export const MAX_OPEN_REPORTS_PER_TARGET = 5;

/** Registro da coleção `reports`: o contrato `Report` + quem denunciou e o dono do alvo. */
export interface DbReport extends Report {
  reporterId: string;
  /** Usuário responsável pelo alvo: o próprio usuário, o capitão do squad ou quem enviou o resultado. Nulo quando não se aplica (partida). */
  targetOwnerUserId: string | null;
}

/** Marcas próprias do que já foi semeado (para não duplicar nem depender de quem criou a coleção primeiro). */
const seedMarks = () => collection<{ key: string; at: string }>('reportSeedMarks');
const DEMO_MARK = 'demo-reports-v1';
const DAY = 24 * 3600_000;

/** A coleção de denúncias. Use sempre este acesso: ele garante os dados de demonstração uma única vez. */
export function reports(): DbReport[] {
  const list = collection<DbReport>('reports');
  const marks = seedMarks();
  if (marks.some((m) => m.key === DEMO_MARK)) return list;
  marks.push({ key: DEMO_MARK, at: nowIso() });
  const now = Date.now();
  const user = (id: string) => db().users.find((u) => u.id === id);
  const bianca = user('u_bianca');
  const lucas = user('u_lucas');
  const admin = user('u_ana');
  const p10 = user('u_p10');
  const p12 = user('u_p12');
  const squad = db().teams.find((t) => t.id === 't_2');
  if (bianca && p10) {
    list.push({
      id: 'rp_demo_1',
      targetType: 'USER',
      targetId: p10.id,
      targetLabel: p10.nickname,
      targetLink: `/u/${encodeURIComponent(p10.nickname)}`,
      reporterNickname: bianca.nickname,
      reason: 'HARASSMENT',
      description: 'Ficou me xingando no chat do jogo depois que perdeu a partida das oitavas.',
      evidenceUrls: [],
      status: 'ACTIONED',
      resolution: 'Conferimos as mensagens e o jogador recebeu uma advertência. Obrigado por avisar.',
      handledByNickname: admin?.nickname ?? null,
      createdAt: new Date(now - 6 * DAY).toISOString(),
      updatedAt: new Date(now - 5 * DAY).toISOString(),
      reporterId: bianca.id,
      targetOwnerUserId: p10.id,
    });
  }
  if (lucas && squad) {
    list.push({
      id: 'rp_demo_2',
      targetType: 'TEAM',
      targetId: squad.id,
      targetLabel: `${squad.name} [${squad.tag}]`,
      targetLink: `/minha-conta/squads/${squad.id}`,
      reporterNickname: lucas.nickname,
      reason: 'CHEATING',
      description: 'Suspeita de jogador usando emulador nas quedas do último treino. Vários abates impossíveis no celular.',
      evidenceUrls: [],
      status: 'OPEN',
      resolution: null,
      handledByNickname: null,
      createdAt: new Date(now - 5 * 3600_000).toISOString(),
      updatedAt: new Date(now - 5 * 3600_000).toISOString(),
      reporterId: lucas.id,
      targetOwnerUserId: squad.captainId,
    });
  }
  if (lucas && p12) {
    list.push({
      id: 'rp_demo_3',
      targetType: 'USER',
      targetId: p12.id,
      targetLabel: p12.nickname,
      targetLink: `/u/${encodeURIComponent(p12.nickname)}`,
      reporterNickname: lucas.nickname,
      reason: 'OFFENSIVE_NAME',
      description: 'O nick no jogo tinha um palavrão. Parece que já foi trocado.',
      evidenceUrls: [],
      status: 'DISMISSED',
      resolution: 'O nick já havia sido alterado quando analisamos. Nenhuma medida foi necessária.',
      handledByNickname: admin?.nickname ?? null,
      createdAt: new Date(now - 12 * DAY).toISOString(),
      updatedAt: new Date(now - 11 * DAY).toISOString(),
      reporterId: lucas.id,
      targetOwnerUserId: p12.id,
    });
  }
  save();
  return list;
}

export function toReport(r: DbReport): Report {
  return {
    id: r.id,
    targetType: r.targetType,
    targetId: r.targetId,
    targetLabel: r.targetLabel,
    targetLink: r.targetLink,
    reporterNickname: r.reporterNickname,
    reason: r.reason,
    description: r.description,
    evidenceUrls: r.evidenceUrls,
    status: r.status,
    resolution: r.resolution,
    handledByNickname: r.handledByNickname,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

interface ResolvedTarget {
  targetId: string;
  targetLabel: string;
  targetLink: string | null;
  targetOwnerUserId: string | null;
}

/** Nome e link da partida a partir do ID global (`<stageId>~<nó>`). Nulo se a partida não existe para o público. */
function resolveMatch(matchId: string): { label: string; link: string } | null {
  try {
    const { stageId, nodeId } = splitMatchId(matchId);
    const { tournament, stage } = findStage(stageId);
    const run = getRun(stageId);
    const node = run?.confirmed ? run.structure.matches.find((m) => m.id === nodeId) : undefined;
    if (!node) return null;
    const names = node.slots.map((s) => {
      const reg = s.entrantId ? db().registrations.find((r) => r.id === s.entrantId) : undefined;
      return reg ? toRegistration(reg).displayName : 'A definir';
    });
    const what = node.kind === 'LOBBY' ? `${stage.name} · ${node.roundLabel}` : `${node.roundLabel}: ${names.join(' x ')}`;
    return { label: `${what} · ${tournament.name}`, link: `/c/${tournament.slug}?aba=partidas` };
  } catch (error) {
    if (error instanceof HttpProblem) return null;
    throw error;
  }
}

/** Confere se o alvo existe e resolve o nome e o link que a moderação vai ver. */
function resolveTarget(input: CreateReportInput): ResolvedTarget {
  const d = db();
  switch (input.targetType) {
    case 'USER': {
      const user = d.users.find((u) => u.id === input.targetId || u.nickname.toLowerCase() === input.targetId.toLowerCase());
      if (!user || user.status === 'DELETED' || user.status === 'MERGED') throw notFound('Usuário');
      return { targetId: user.id, targetLabel: user.nickname, targetLink: `/u/${encodeURIComponent(user.nickname)}`, targetOwnerUserId: user.id };
    }
    case 'TEAM': {
      const team = d.teams.find((t) => t.id === input.targetId);
      if (!team) throw notFound('Squad');
      return { targetId: team.id, targetLabel: `${team.name} [${team.tag}]`, targetLink: `/minha-conta/squads/${team.id}`, targetOwnerUserId: team.captainId };
    }
    case 'MATCH': {
      const match = resolveMatch(input.targetId);
      if (!match) throw notFound('Partida');
      return { targetId: input.targetId, targetLabel: match.label, targetLink: match.link, targetOwnerUserId: null };
    }
    case 'RESULT': {
      // O alvo é um resultado enviado por participante (ID do envio) ou o resultado de uma partida (ID da partida).
      const submission = submissions().find((s) => s.id === input.targetId);
      const match = resolveMatch(submission?.matchId ?? input.targetId);
      if (!match) throw notFound('Resultado');
      return { targetId: input.targetId, targetLabel: `Resultado de ${match.label}`, targetLink: match.link, targetOwnerUserId: submission?.submittedByUserId ?? null };
    }
  }
}

function create(user: DbUser, input: CreateReportInput): DbReport {
  const target = resolveTarget(input);
  if (target.targetOwnerUserId === user.id) {
    throw badRequest(input.targetType === 'USER' ? 'Você não pode denunciar a si mesmo.' : 'Você não pode denunciar algo que é seu.', 'REPORT_SELF');
  }
  const list = reports();
  const open = list.filter((r) => r.reporterId === user.id && r.targetType === input.targetType && r.targetId === target.targetId && (r.status === 'OPEN' || r.status === 'IN_REVIEW'));
  if (open.length >= MAX_OPEN_REPORTS_PER_TARGET) {
    throw conflict('Você já tem denúncias em aberto sobre isto. Aguarde a análise da moderação antes de enviar outra.', 'REPORT_LIMIT');
  }
  const at = nowIso();
  const record: DbReport = {
    id: uid('rp'),
    targetType: input.targetType,
    targetId: target.targetId,
    targetLabel: target.targetLabel,
    targetLink: target.targetLink,
    reporterNickname: user.nickname,
    reason: input.reason,
    description: input.description.trim(),
    evidenceUrls: input.evidenceUrls,
    status: 'OPEN',
    resolution: null,
    handledByNickname: null,
    createdAt: at,
    updatedAt: at,
    reporterId: user.id,
    targetOwnerUserId: target.targetOwnerUserId,
  };
  list.push(record);
  save();
  return record;
}

export const handlers: HttpHandler[] = [
  http.post(
    url('/reports'),
    handle(async ({ request }) => {
      const user = requireUser();
      const input = await body(request, CreateReportInput);
      return json(toReport(create(user, input)), 201);
    }),
  ),

  /** As minhas denúncias, com o status e a resposta da moderação. As mais recentes primeiro. */
  http.get(
    url('/me/reports'),
    handle(() => {
      const user = requireUser();
      const mine = reports()
        .filter((r) => r.reporterId === user.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return json(mine.map(toReport));
    }),
  ),
];
