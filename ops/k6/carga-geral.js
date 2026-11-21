/**
 * Carga geral (issue #112, plano R2 "Testes"): 5.000 usuários simultâneos em 50 campeonatos ativos.
 *
 *   k6 run -e BASE_URL=https://<staging> -e VERCEL_AUTOMATION_BYPASS_SECRET=... -e SLOT=1 ops/k6/carga-geral.js
 *
 * Antes: `preparar-dados.mts` (contas e sessões) e `montar-campeonatos.js` (os 50 campeonatos, com outra vaga).
 * Ensaio pequeno: `-e ESCALA=0.02` (100 usuários).
 *
 * Mistura (por usuário simultâneo, com tempo de leitura entre as ações, como gente de verdade):
 * - `visitantes` (80%, 4.000): vitrine, página do campeonato, chave, classificação, partidas, perfil — só leitura,
 *   a maior parte servida pela CDN (ISR e `Cache-Control` público);
 * - `jogadores` (19%, 950): logados, acompanham "ao vivo" (a chave a cada 10 s, como o polling de reserva das telas),
 *   notificações, inscrições; seguem e deixam de seguir campeonatos (escrita leve);
 * - `organizacao` (1%, 50 VUs): lançam resultados nas partidas pendentes dos 50 campeonatos (escrita pesada:
 *   motor + classificação + tempo real + revalidação da página).
 *
 * Metas (thresholds): API leitura p95 ≤ 300 ms, escrita p95 ≤ 600 ms, erro < 1%, nenhum 5xx (`erros_servidor`).
 */
import { sleep } from 'k6';
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';
import { METAS, PREFIXO, vus } from './lib/config.js';
import { escrever, json, ler, pagina, sortear } from './lib/http.js';
import { lancarResultado, partidas, pendente } from './lib/campeonato.js';
import { contaDoVu, garantirSessao } from './lib/sessao.js';

const ARQUIVO = __ENV.SESSOES || './dados/sessoes.json';
const participantes = new SharedArray('participantes', () => JSON.parse(open(ARQUIVO)).participantes);
const organizadores = new SharedArray('organizadores', () => {
  const dados = JSON.parse(open(ARQUIVO));
  // Os campeonatos da carga são todos da primeira conta de organização: só os assentos dela servem.
  return dados.organizadores.filter((o) => o.userId === dados.organizadores[0].userId);
});

const SUBIDA = __ENV.SUBIDA || '5m';
const PLATO = __ENV.PLATO || '15m';
const DESCIDA = __ENV.DESCIDA || '2m';
const VISITANTES = vus(4000);
const JOGADORES = vus(950);
const ORGANIZACAO = Math.min(vus(50), organizadores.length);

export const options = {
  noCookiesReset: true,
  discardResponseBodies: false,
  setupTimeout: '2m',
  scenarios: {
    visitantes: {
      executor: 'ramping-vus',
      exec: 'visitante',
      stages: [{ duration: SUBIDA, target: VISITANTES }, { duration: PLATO, target: VISITANTES }, { duration: DESCIDA, target: 0 }],
      gracefulRampDown: '30s',
    },
    jogadores: {
      executor: 'ramping-vus',
      exec: 'jogador',
      stages: [{ duration: SUBIDA, target: JOGADORES }, { duration: PLATO, target: JOGADORES }, { duration: DESCIDA, target: 0 }],
      gracefulRampDown: '30s',
    },
    organizacao: { executor: 'constant-vus', exec: 'organizacao', vus: ORGANIZACAO, duration: `${parseInt(SUBIDA) + parseInt(PLATO)}m` },
  },
  thresholds: METAS,
};

/** Os campeonatos da carga (montados antes) e alguns apelidos para visitar perfis. */
export function setup() {
  const lista = [];
  let cursor = '';
  for (let pagina_ = 0; pagina_ < 5 && lista.length < 50; pagina_++) {
    const res = json(ler(`/tournaments?q=${encodeURIComponent(PREFIXO)}&status=live&limit=50${cursor ? `&cursor=${cursor}` : ''}`, 'tournaments/list'));
    if (!res) break;
    lista.push(...(res.items || []));
    if (!res.nextCursor) break;
    cursor = encodeURIComponent(res.nextCursor);
  }
  if (lista.length === 0) throw new Error(`Nenhum campeonato "${PREFIXO}" em andamento. Rode montar-campeonatos.js antes.`);
  const campeonatos = lista.slice(0, 50).map((t) => {
    const detalhe = json(ler(`/tournaments/${t.slug}`, 'tournaments/detail')) || {};
    return { id: t.id, slug: t.slug, stageId: ((detalhe.stages || [])[0] || {}).id };
  });
  const apelidos = participantes.slice(0, 200).map((p) => p.nickname);
  console.log(`Carga sobre ${campeonatos.length} campeonatos.`);
  return { campeonatos, apelidos };
}

const pensar = (min, max) => sleep(min + Math.random() * (max - min));

/** Visitante: vitrine → campeonato → chave e classificação → um perfil. */
export function visitante(dados) {
  const c = sortear(dados.campeonatos);
  pagina('/', 'home');
  pensar(2, 5);
  pagina('/campeonatos', 'vitrine');
  ler('/tournaments?limit=20', 'tournaments/list');
  ler('/games', 'games');
  pensar(2, 5);
  pagina(`/c/${c.slug}`, 'campeonato');
  ler(`/tournaments/${c.slug}`, 'tournaments/detail');
  ler(`/tournaments/${c.id}/announcements`, 'tournaments/announcements');
  pensar(3, 8);
  if (c.stageId) {
    ler(`/stages/${c.stageId}/bracket`, 'stages/bracket');
    ler(`/stages/${c.stageId}/standings`, 'stages/standings');
  }
  ler(`/tournaments/${c.id}/matches`, 'matches/list');
  pensar(3, 8);
  if (Math.random() < 0.3) {
    const nick = sortear(dados.apelidos);
    pagina(`/u/${nick}`, 'perfil');
    ler(`/users/${nick}`, 'users/profile');
    ler(`/users/${nick}/stats`, 'users/stats');
    pensar(2, 5);
  }
  if (Math.random() < 0.2) {
    pagina('/ranking', 'ranking');
    pensar(2, 4);
  }
}

/** Jogador logado acompanhando um campeonato ao vivo. */
export function jogador(dados) {
  const conta = contaDoVu(participantes);
  if (!garantirSessao(conta)) {
    pensar(5, 10);
    return;
  }
  const c = dados.campeonatos[exec.vu.idInTest % dados.campeonatos.length];
  ler('/me', 'me');
  ler('/notifications/unread-count', 'notifications/unread-count');
  ler('/me/registrations', 'me/registrations');
  pensar(2, 4);
  // "Ao vivo": a tela consulta de novo a cada 10 s quando o tempo real cai (CT-10). Aqui, 6 ciclos = 1 min.
  for (let i = 0; i < 6; i++) {
    if (c.stageId) ler(`/stages/${c.stageId}/bracket`, 'stages/bracket');
    ler(`/tournaments/${c.id}/matches?mine=1`, 'matches/mine');
    sleep(10);
  }
  if (Math.random() < 0.3) {
    escrever('PUT', `/me/follows/tournament/${c.id}`, undefined, 'follows/put');
    pensar(1, 3);
    escrever('DELETE', `/me/follows/tournament/${c.id}`, undefined, 'follows/delete');
  }
  if (Math.random() < 0.2) {
    ler('/notifications', 'notifications/list');
    escrever('POST', '/notifications/read-all', undefined, 'notifications/read-all');
  }
  pensar(3, 6);
}

/** Índice do VU dentro do cenário de organização (fixado na 1ª iteração: todos começam juntos). */
let assento;

/** Organização: lança o resultado de uma partida pendente por vez nos campeonatos que cabem a este VU. */
export function organizacao(dados) {
  if (assento === undefined) assento = exec.scenario.iterationInTest;
  const conta = organizadores[assento % organizadores.length];
  if (!garantirSessao(conta)) {
    pensar(10, 20);
    return;
  }
  const meus = dados.campeonatos.filter((_, i) => i % ORGANIZACAO === assento % ORGANIZACAO);
  for (const c of meus) {
    const pendentes = partidas(c.id).filter(pendente);
    if (pendentes.length > 0) {
      lancarResultado(sortear(pendentes));
      pensar(5, 10);
    }
  }
  pensar(5, 10);
}
