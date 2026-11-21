/**
 * Campeonato de 1.024 participantes de ponta a ponta (issue #112), pela API real e com as contas de carga:
 *
 *   k6 run -e BASE_URL=https://<staging> -e VERCEL_AUTOMATION_BYPASS_SECRET=... -e SLOT=2 ops/k6/campeonato-1024.js
 *
 * Fases (em sequência, pelo `startTime` de cada cenário):
 * 1. `setup`: a organização cria e publica o campeonato (mata-mata, 1.024 vagas, check-in de 30 a 10 min antes).
 * 2. `inscricoes`: os 1.024 participantes se inscrevem **ao mesmo tempo** (CT-02: vagas nunca estouram; o
 *    excedente recebe 409 ou vai para a lista de espera).
 * 3. `chave`: a organização encerra as inscrições, sorteia e confirma a chave e agenda a 1ª rodada para daqui a
 *    20 min (a janela de check-in já abre).
 * 4. `checkin`: os 1.024 fazem check-in na própria partida em 1 minuto.
 * 5. `resultados`: 10 VUs da organização lançam os resultados rodada a rodada até a final (1.023 partidas).
 *
 * Saída esperada: final com resultado, nenhum 5xx, inscrições confirmadas = 1.024, metas de latência atingidas.
 */
import { sleep } from 'k6';
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';
import { Counter } from 'k6/metrics';
import { METAS } from './lib/config.js';
import { escrever } from './lib/http.js';
import { agendarRodada, criarEPublicar, fecharEGerarChave, inscrever, jogoDeDuelo, lancarResultado, partidas, pendente } from './lib/campeonato.js';
import { garantirSessao } from './lib/sessao.js';

const ARQUIVO = __ENV.SESSOES || './dados/sessoes.json';
const VAGAS = Number(__ENV.VAGAS || '1024');
const participantes = new SharedArray('participantes', () => JSON.parse(open(ARQUIVO)).participantes);
const organizadores = new SharedArray('organizadores', () => {
  const dados = JSON.parse(open(ARQUIVO));
  return dados.organizadores.filter((o) => o.userId === dados.organizadores[0].userId);
});

const inscritos = new Counter('inscricoes_confirmadas');
const checkins = new Counter('checkins_feitos');
const resultados = new Counter('resultados_lancados');

export const options = {
  noCookiesReset: true,
  setupTimeout: '2m',
  scenarios: {
    inscricoes: { executor: 'per-vu-iterations', exec: 'inscricao', vus: VAGAS, iterations: 1, maxDuration: '5m', startTime: '0s' },
    chave: { executor: 'per-vu-iterations', exec: 'chave', vus: 1, iterations: 1, maxDuration: '5m', startTime: '5m' },
    checkin: { executor: 'per-vu-iterations', exec: 'checkin', vus: VAGAS, iterations: 1, maxDuration: '5m', startTime: '10m' },
    resultados: { executor: 'per-vu-iterations', exec: 'resultado', vus: 10, iterations: 1, maxDuration: '40m', startTime: '15m' },
  },
  thresholds: {
    ...METAS,
    inscricoes_confirmadas: [`count>=${VAGAS}`],
    'checks{scenario:resultados}': ['rate>0.99'],
  },
};

export function setup() {
  if (!garantirSessao(organizadores[0])) throw new Error('A sessão do organizador de carga não abriu (vaga SLOT já usada?).');
  const t = criarEPublicar(jogoDeDuelo(), { vagas: VAGAS, checkIn: true });
  console.log(`Campeonato de ${VAGAS}: /c/${t.slug}`);
  return t;
}

/**
 * Conta da iteração: `iterationInTest` vai de 0 a VAGAS-1 dentro do cenário (uma iteração por VU). Não use o ID do
 * VU: o k6 reaproveita VUs entre cenários que não se sobrepõem, e a inscrição e o check-in precisam da mesma conta.
 */
function contaDaIteracao() {
  const conta = participantes[exec.scenario.iterationInTest];
  if (!conta) throw new Error(`Faltam contas: dados/sessoes.json tem ${participantes.length}, o teste precisa de ${VAGAS}.`);
  return conta;
}

/** Cada iteração = um participante diferente. Todos disparam juntos. */
export function inscricao(t) {
  const conta = contaDaIteracao();
  if (!garantirSessao(conta)) return;
  const r = inscrever(t.id);
  if (r && r.status === 'CONFIRMED') inscritos.add(1);
}

export function chave(t) {
  if (!garantirSessao(organizadores[1])) throw new Error('A sessão do organizador (assento 1) não abriu.');
  fecharEGerarChave(t.id, t.stageId);
  agendarRodada(t.stageId, 1, 20);
}

/** Cada participante faz check-in na própria partida (mesma conta da inscrição, pela ordem da iteração). */
export function checkin(t) {
  const conta = contaDaIteracao();
  if (!garantirSessao(conta)) return;
  sleep(Math.random() * 60);
  const minha = partidas(t.id, true).find((p) => p.round === 1);
  if (!minha) return;
  const res = escrever('POST', `/matches/${encodeURIComponent(minha.id)}/check-in`, undefined, 'matches/check-in', { aceitar: [409] });
  if (res.status === 200 || res.status === 201) checkins.add(1);
}

/** Dez VUs da organização dividem as partidas pendentes até a final. */
export function resultado(t) {
  const indice = exec.scenario.iterationInTest % 10;
  if (!garantirSessao(organizadores[2 + indice])) return;
  for (let rodada = 0; rodada < 20; rodada++) {
    const todas = partidas(t.id);
    const pendentes = todas.filter(pendente).filter((_, i) => i % 10 === indice);
    for (const p of pendentes) {
      const res = lancarResultado(p);
      if (res.status === 200) resultados.add(1);
    }
    const final = todas.find((p) => !p.nextMatchId && p.bracket !== 'THIRD_PLACE');
    if (final && ['VALIDATED', 'WALKOVER'].includes(final.status)) return;
    sleep(3);
  }
}
