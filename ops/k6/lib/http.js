/**
 * Requisições marcadas por tipo (`leitura`, `escrita`, `pagina`): as metas de latência do PRD são por tipo.
 * Toda mutação manda `Origin` (a API recusa mutação sem ele: proteção contra CSRF, `packages/api/src/security.ts`).
 */
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { API, BASE_URL, baseHeaders } from './config.js';

/** 5xx: erro do nosso lado (banco sem conexão, função estourando). A meta é zero. */
export const errosServidor = new Counter('erros_servidor');
/** 429: o limite de tentativas ou o Firewall barrou o gerador (o IP dele não foi liberado?). */
export const limitados = new Counter('limitados_429');

function registrar(res, nome) {
  if (res.status >= 500) errosServidor.add(1, { nome });
  if (res.status === 429) limitados.add(1, { nome });
  return res;
}

/** Página HTML (vitrine, campeonato, perfil). */
export function pagina(caminho, nome) {
  const res = http.get(`${BASE_URL}${caminho}`, { headers: baseHeaders({ Accept: 'text/html' }), tags: { tipo: 'pagina', nome } });
  check(res, { [`${nome}: 200`]: (r) => r.status === 200 });
  return registrar(res, nome);
}

/** GET na API. `aceitar`: status que contam como sucesso além do 200 (ex.: 404 de recurso que sumiu). */
export function ler(caminho, nome, aceitar = []) {
  const res = http.get(`${API}${caminho}`, {
    headers: baseHeaders({ Accept: 'application/json' }),
    tags: { tipo: 'leitura', nome },
    responseCallback: http.expectedStatuses(200, ...aceitar),
  });
  check(res, { [`${nome}: ok`]: (r) => r.status === 200 || aceitar.includes(r.status) });
  return registrar(res, nome);
}

/** Mutação na API (POST, PUT, PATCH, DELETE) com corpo JSON opcional. */
export function escrever(metodo, caminho, corpo, nome, { aceitar = [], headers = {} } = {}) {
  const esperados = [200, 201, 202, 204, ...aceitar];
  const res = http.request(metodo, `${API}${caminho}`, corpo === undefined ? null : JSON.stringify(corpo), {
    headers: baseHeaders({ Accept: 'application/json', 'Content-Type': 'application/json', Origin: BASE_URL, ...headers }),
    tags: { tipo: 'escrita', nome },
    responseCallback: http.expectedStatuses(...esperados),
  });
  check(res, { [`${nome}: ok`]: (r) => esperados.includes(r.status) });
  return registrar(res, nome);
}

/** Corpo JSON ou `null` (resposta vazia ou não JSON). */
export function json(res) {
  try {
    return res.body ? JSON.parse(res.body) : null;
  } catch {
    return null;
  }
}

/** Escolhe um item ao acaso. */
export function sortear(lista) {
  return lista[Math.floor(Math.random() * lista.length)];
}
