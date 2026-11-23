/**
 * Passos da organização pela API real (os mesmos que as telas usam): criar, publicar, encerrar inscrições,
 * gerar e confirmar a chave, agendar rodada e lançar resultado. Usados por `montar-campeonatos.js` e
 * `campeonato-1024.js`. Quem chama precisa estar com a sessão de um organizador (`garantirSessao`).
 */
import { fail } from 'k6';
import { escrever, idUnico, json, ler } from './http.js';
import { PREFIXO } from './config.js';

const DIA = 24 * 3600 * 1000;

/** Um jogo de duelo 1x1 com modelo de pontuação padrão do catálogo (eFootball ou 8 Ball Pool no seed). */
export function jogoDeDuelo() {
  const jogos = json(ler('/games', 'games')) || [];
  for (const jogo of jogos) {
    const modo = (jogo.modes || []).find((m) => m.teamSize === 1 && m.matchType === 'DUEL');
    const modelos = (jogo.scoringModels || []).filter((s) => s.matchType === 'DUEL' && s.ownerId === null);
    const modelo = modelos.find((s) => s.isDefault) || modelos[0];
    if (modo && modelo) return { gameId: jogo.id, modeId: modo.id, modelId: modelo.id };
  }
  fail('Nenhum jogo de duelo 1x1 no catálogo do staging (o seed rodou?).');
}

/** Cria e publica um campeonato de mata-mata simples. Devolve `{ id, slug, stageId }`. */
export function criarEPublicar(jogo, { vagas, checkIn = true, nome }) {
  const criado = escrever(
    'POST',
    '/tournaments',
    {
      name: nome || `${PREFIXO} ${idUnico('c')}`,
      description: '<p>Campeonato criado pelo teste de carga (issue #112). Pode ser cancelado.</p>',
      rules: '<p>Regulamento de teste.</p>',
      gameId: jogo.gameId,
      gameModeId: jogo.modeId,
      maxParticipants: vagas,
      registrationClosesAt: new Date(Date.now() + 5 * DIA).toISOString(),
      startsAt: new Date(Date.now() + 6 * DIA).toISOString(),
      checkIn: { enabled: checkIn, opensMinutesBefore: 30, closesMinutesBefore: 10, requireAllMembers: false },
      stages: [{ name: 'Mata-mata', format: 'SINGLE_ELIM', scoringModelId: jogo.modelId, config: {}, qualification: null, tiebreakers: ['points', 'wins'], seeding: 'RANDOM' }],
    },
    'tournaments/create',
  );
  const t = json(criado);
  if (criado.status !== 201 || !t) fail(`Não foi possível criar o campeonato: ${criado.status} ${criado.body}`);
  const publicado = json(escrever('POST', `/tournaments/${t.id}/publish`, undefined, 'tournaments/publish'));
  if (!publicado) fail('Não foi possível publicar o campeonato.');
  return { id: t.id, slug: publicado.slug, stageId: (publicado.stages || t.stages || [])[0]?.id };
}

/** Inscreve a pessoa logada (solo). 409 de vaga esgotada ou inscrição repetida conta como resposta esperada. */
export function inscrever(tournamentId) {
  const res = escrever('POST', `/tournaments/${tournamentId}/registrations`, { acceptRules: true }, 'registrations/create', { aceitar: [409] });
  return res.status === 201 ? json(res) : null;
}

/** Encerra as inscrições, gera (sorteio) e confirma a chave da primeira fase. */
export function fecharEGerarChave(tournamentId, stageId) {
  escrever('POST', `/tournaments/${tournamentId}/close-registration`, undefined, 'tournaments/close-registration', { aceitar: [409] });
  escrever('POST', `/stages/${stageId}/generate`, { seeding: 'RANDOM' }, 'stages/generate', { aceitar: [409] });
  escrever('POST', `/stages/${stageId}/confirm`, undefined, 'stages/confirm', { aceitar: [409] });
}

/** Agenda a rodada para daqui a `minutos` (com o check-in de 30 a 10 min antes, a janela abre na hora). */
export function agendarRodada(stageId, rodada, minutos = 20) {
  return escrever('POST', `/stages/${stageId}/schedule-round`, { round: rodada, startsAt: new Date(Date.now() + minutos * 60 * 1000).toISOString(), intervalMinutes: 0 }, 'stages/schedule-round', {
    aceitar: [409],
  });
}

/** Partidas do campeonato (`mine=1`: só as da pessoa logada). */
export function partidas(tournamentId, minhas = false) {
  return json(ler(`/tournaments/${tournamentId}/matches${minhas ? '?mine=1' : ''}`, minhas ? 'matches/mine' : 'matches/list')) || [];
}

/** Partida pronta para receber resultado: dois participantes conhecidos e ainda sem resultado. */
export function pendente(partida) {
  const conhecidos = (partida.participants || []).filter((p) => p.registrationId);
  return conhecidos.length === 2 && !partida.waitingPrevious && !['VALIDATED', 'WALKOVER', 'CANCELLED'].includes(partida.status);
}

/** Lança o resultado (2 x 0 para o primeiro participante). Só estatísticas brutas: os pontos vêm do motor. */
export function lancarResultado(partida) {
  const [a, b] = partida.participants.filter((p) => p.registrationId);
  return escrever(
    'PUT',
    `/matches/${encodeURIComponent(partida.id)}/result`,
    { entries: [{ registrationId: a.registrationId, score: 2 }, { registrationId: b.registrationId, score: 0 }], evidenceUrls: [] },
    'matches/result',
    { aceitar: [409], headers: { 'Idempotency-Key': `k6-${partida.id}` } },
  );
}
