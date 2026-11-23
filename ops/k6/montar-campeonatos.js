/**
 * Monta o cenário do teste de carga geral (issue #112): 50 campeonatos ativos, cada um com 32 participantes
 * inscritos e a chave confirmada (status "Em andamento"). Rode uma vez antes de `carga-geral.js`.
 *
 *   k6 run -e BASE_URL=https://<staging> -e VERCEL_AUTOMATION_BYPASS_SECRET=... -e SLOT=0 ops/k6/montar-campeonatos.js
 *
 * Fases: `setup` (organização cria e publica os 50) → `inscricoes` (1.600 participantes se inscrevem, um VU por
 * conta) → `teardown` (organização encerra as inscrições, gera e confirma as chaves e agenda a 1ª rodada).
 */
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';
import { vus } from './lib/config.js';
import { agendarRodada, criarEPublicar, fecharEGerarChave, inscrever, jogoDeDuelo } from './lib/campeonato.js';
import { garantirSessao } from './lib/sessao.js';

const ARQUIVO = __ENV.SESSOES || './dados/sessoes.json';
const participantes = new SharedArray('participantes', () => JSON.parse(open(ARQUIVO)).participantes);
const organizadores = new SharedArray('organizadores', () => JSON.parse(open(ARQUIVO)).organizadores);

const CAMPEONATOS = vus(Number(__ENV.CAMPEONATOS || '50'));
const POR_CAMPEONATO = Number(__ENV.POR_CAMPEONATO || '32');

export const options = {
  noCookiesReset: true,
  setupTimeout: '10m',
  teardownTimeout: '20m',
  scenarios: {
    inscricoes: { executor: 'per-vu-iterations', vus: CAMPEONATOS * POR_CAMPEONATO, iterations: 1, maxDuration: '10m' },
  },
  thresholds: { checks: ['rate>0.98'] },
};

export function setup() {
  // Assento 0 da primeira conta de organização (o teardown usa o assento 1 da mesma conta: o dono dos campeonatos).
  if (!garantirSessao(organizadores[0])) throw new Error('A sessão do organizador de carga não abriu (dados/sessoes.json é deste staging? A vaga SLOT já foi usada?).');
  const jogo = jogoDeDuelo();
  const lista = [];
  for (let i = 0; i < CAMPEONATOS; i++) lista.push(criarEPublicar(jogo, { vagas: POR_CAMPEONATO, checkIn: true }));
  return { campeonatos: lista };
}

export default function (dados) {
  // Uma iteração por VU: `iterationInTest` (0 a N-1) escolhe a conta e o campeonato sem repetir.
  const n = exec.scenario.iterationInTest;
  const conta = participantes[n];
  if (!conta) throw new Error(`Faltam contas: dados/sessoes.json tem ${participantes.length}, o teste precisa de ${CAMPEONATOS * POR_CAMPEONATO}.`);
  if (!garantirSessao(conta)) return;
  const campeonato = dados.campeonatos[Math.floor(n / POR_CAMPEONATO) % dados.campeonatos.length];
  inscrever(campeonato.id);
}

export function teardown(dados) {
  if (!garantirSessao(organizadores[1])) throw new Error('A sessão do organizador (assento 1) não abriu.');
  for (const c of dados.campeonatos) {
    fecharEGerarChave(c.id, c.stageId);
    agendarRodada(c.stageId, 1, 120);
  }
  console.log(`Campeonatos ativos: ${dados.campeonatos.map((c) => c.slug).join(', ')}`);
}
