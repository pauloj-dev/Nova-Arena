/**
 * Tempo real com 2.000 conexões simultâneas (issue #112, ADR-005, plano §2.3).
 *
 *   k6 run -e BASE_URL=https://<staging> -e VERCEL_AUTOMATION_BYPASS_SECRET=... -e SLOT=1 ops/k6/tempo-real.js
 *
 * Cada VU faz o que o navegador faz numa página ao vivo (`apps/web/shared/realtime/ably-client.ts`):
 * 1. `POST /api/v1/realtime/token` na nossa API (visitante: só `tournament:*`, assinatura sem publicar);
 * 2. troca o "token request" assinado por um token no Ably (`/keys/<keyName>/requestToken`);
 * 3. abre o WebSocket do Ably, assina `tournament:<id>` de um dos campeonatos da carga e fica conectado.
 *
 * Para haver eventos chegando, rode junto o `carga-geral.js` (a organização lança resultados) ou passe
 * `-e EVENTOS=1`: 5 VUs da organização lançam resultados nos campeonatos assinados enquanto as conexões estão
 * abertas. A latência ponta a ponta (resultado salvo → evento no navegador) sai em `ably_atraso_evento_ms`.
 *
 * Precisa de um plano do Ably com folga para 2.000 conexões e para o ritmo de novas conexões (ver README).
 * Protocolo do Ably (JSON, v2): ação 4 = CONNECTED, 9 = ERROR, 10 = ATTACH, 11 = ATTACHED, 15 = MESSAGE, 0 = HEARTBEAT.
 */
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';
import http from 'k6/http';
import { Counter, Rate, Trend } from 'k6/metrics';
import ws from 'k6/ws';
import { METAS, PREFIXO, vus } from './lib/config.js';
import { escrever, json, ler, sortear } from './lib/http.js';
import { lancarResultado, partidas, pendente } from './lib/campeonato.js';
import { garantirSessao } from './lib/sessao.js';

const ABLY_REST = (__ENV.ABLY_REST || 'https://main.realtime.ably.net').replace(/\/+$/, '');
const ABLY_WS = (__ENV.ABLY_WS || 'wss://main.realtime.ably.net').replace(/\/+$/, '');
const CONEXOES = vus(Number(__ENV.CONEXOES || '2000'));
const SUBIDA_S = Number(__ENV.SUBIDA_S || '120');
const MANTER_S = Number(__ENV.MANTER_S || '600');
const EVENTOS = __ENV.EVENTOS === '1';

const ARQUIVO = __ENV.SESSOES || './dados/sessoes.json';
const organizadores = EVENTOS
  ? new SharedArray('organizadores', () => {
      const dados = JSON.parse(open(ARQUIVO));
      return dados.organizadores.filter((o) => o.userId === dados.organizadores[0].userId);
    })
  : [];

const conectou = new Rate('ably_conectou');
const tempoConexao = new Trend('ably_conexao_ms', true);
const tempoAssinatura = new Trend('ably_assinatura_ms', true);
const atrasoEvento = new Trend('ably_atraso_evento_ms', true);
const mensagens = new Counter('ably_mensagens');
const errosAbly = new Counter('ably_erros');

const cenarios = {
  conexoes: { executor: 'per-vu-iterations', exec: 'conexao', vus: CONEXOES, iterations: 1, maxDuration: `${SUBIDA_S + MANTER_S + 120}s` },
};
if (EVENTOS) {
  cenarios.eventos = { executor: 'constant-vus', exec: 'gerarEventos', vus: Math.min(5, organizadores.length), duration: `${SUBIDA_S + MANTER_S}s` };
}

export const options = {
  noCookiesReset: true,
  scenarios: cenarios,
  thresholds: {
    'http_req_duration{nome:realtime/token}': ['p(95)<600'],
    http_req_failed: METAS.http_req_failed,
    erros_servidor: METAS.erros_servidor,
    ably_conectou: ['rate>0.99'],
    ably_conexao_ms: ['p(95)<2000'],
    ably_assinatura_ms: ['p(95)<1000'],
    ably_atraso_evento_ms: ['p(95)<2000'],
  },
};

export function setup() {
  const res = json(ler(`/tournaments?q=${encodeURIComponent(PREFIXO)}&status=live&limit=50`, 'tournaments/list'));
  const campeonatos = ((res && res.items) || []).map((t) => ({ id: t.id, slug: t.slug }));
  if (campeonatos.length === 0) throw new Error(`Nenhum campeonato "${PREFIXO}" em andamento. Rode montar-campeonatos.js antes.`);
  return { campeonatos };
}

/** Uma conexão do Ably mantida aberta por `MANTER_S` segundos, assinando o canal de um campeonato. */
export function conexao(dados) {
  // Espalha as conexões na subida (o Ably limita o ritmo de conexões novas por conta).
  sleep(Math.random() * SUBIDA_S);
  const campeonato = dados.campeonatos[exec.scenario.iterationInTest % dados.campeonatos.length];
  const canal = `tournament:${campeonato.id}`;

  const pedido = json(escrever('POST', '/realtime/token', {}, 'realtime/token'));
  if (!pedido || !pedido.keyName) {
    conectou.add(false);
    errosAbly.add(1, { etapa: 'token-api' });
    return;
  }
  const trocado = http.post(`${ABLY_REST}/keys/${encodeURIComponent(pedido.keyName)}/requestToken`, JSON.stringify(pedido), {
    headers: { 'Content-Type': 'application/json' },
    tags: { nome: 'ably/requestToken' },
  });
  const token = json(trocado);
  if (!check(trocado, { 'Ably trocou o token': (r) => r.status === 201 || r.status === 200 }) || !token || !token.token) {
    conectou.add(false);
    errosAbly.add(1, { etapa: 'token-ably' });
    return;
  }

  const inicio = Date.now();
  let conectadoEm = 0;
  const url = `${ABLY_WS}/?access_token=${encodeURIComponent(token.token)}&format=json&v=2&heartbeats=true`;
  const res = ws.connect(url, { tags: { nome: 'ably/ws' } }, (socket) => {
    socket.on('message', (texto) => {
      let msg;
      try {
        msg = JSON.parse(texto);
      } catch {
        return;
      }
      switch (msg.action) {
        case 4: // CONNECTED
          conectadoEm = Date.now();
          tempoConexao.add(conectadoEm - inicio);
          conectou.add(true);
          socket.send(JSON.stringify({ action: 10, channel: canal }));
          break;
        case 11: // ATTACHED
          tempoAssinatura.add(Date.now() - conectadoEm);
          break;
        case 15: // MESSAGE: o evento leva só o que mudou; o horário do Ably mede o atraso até aqui
          for (const m of msg.messages || []) {
            mensagens.add(1);
            if (m.timestamp || msg.timestamp) atrasoEvento.add(Math.max(0, Date.now() - (m.timestamp || msg.timestamp)));
          }
          break;
        case 9: // ERROR
          errosAbly.add(1, { etapa: 'ws', codigo: String((msg.error && msg.error.code) || '') });
          break;
        default:
          break;
      }
    });
    socket.on('error', () => errosAbly.add(1, { etapa: 'ws' }));
    socket.setTimeout(() => {
      socket.send(JSON.stringify({ action: 7 })); // CLOSE
      socket.close();
    }, MANTER_S * 1000);
  });
  if (!conectadoEm) conectou.add(false);
  check(res, { 'WebSocket do Ably aberto (101)': (r) => r && r.status === 101 });
}

let assento;

/** Opcional (`EVENTOS=1`): a organização lança resultados para gerar eventos nos canais assinados. */
export function gerarEventos(dados) {
  if (assento === undefined) assento = exec.scenario.iterationInTest;
  if (!garantirSessao(organizadores[assento % organizadores.length])) {
    sleep(10);
    return;
  }
  const c = sortear(dados.campeonatos);
  const pendentes = partidas(c.id).filter(pendente);
  if (pendentes.length > 0) lancarResultado(sortear(pendentes));
  sleep(5 + Math.random() * 5);
}
