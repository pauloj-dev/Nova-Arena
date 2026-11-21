/**
 * Sessão de um VU com a API real, sem passar pelo login.
 *
 * O login aceita 5 tentativas por minuto por IP (RNF-07) e o cadastro passa pelo BotID: milhares de VUs saindo de
 * poucas máquinas nunca entrariam por ali. Por isso `preparar-dados.mts` abre as sessões direto no banco do staging
 * e grava os refresh tokens em `dados/sessoes.json`. Aqui o VU coloca o token no cookie `na_rt` e chama
 * `POST /auth/refresh`, como o navegador faz: recebe o token de acesso (15 min) e um refresh novo (rotação).
 *
 * Regras:
 * - **Um refresh token por VU.** O refresh gira a cada uso e o reuso de um token já trocado derruba a família
 *   inteira (detecção de roubo, `packages/api/src/auth/session.ts`). Dois VUs com o mesmo token = os dois saem.
 * - **Cada execução gasta uma "vaga"** (`SLOT`, padrão 0): o token original deixa de valer depois do primeiro uso.
 *   `preparar-dados.mts` gera várias vagas por conta (`--vagas`); para rodar mais vezes, prepare de novo.
 * - As opções do teste precisam de `noCookiesReset: true` (o k6 zera o cookie jar a cada iteração por padrão).
 * - O k6 pode reaproveitar um VU entre cenários que não se sobrepõem: por isso o estado é guardado por conta, e
 *   trocar de conta no mesmo VU guarda o refresh atual antes de limpar o cookie jar.
 */
import http from 'k6/http';
import exec from 'k6/execution';
import { check } from 'k6';
import { API, BASE_URL, baseHeaders } from './config.js';

export const SLOT = Number(__ENV.SLOT || '0');
const RENOVAR_A_CADA_MS = 10 * 60 * 1000;
const REFRESH_URL = `${API}/auth/refresh`;

/** Por conta (chave = token original da vaga): o refresh mais recente e quando foi renovado. */
const estado = {};
let contaAtual = null;

/** Token da vaga desta execução. */
export function tokenDaVaga(conta) {
  const token = (conta.refreshTokens || [])[SLOT];
  if (!token) throw new Error(`A conta ${conta.nickname} não tem a vaga ${SLOT}. Rode preparar-dados.mts com --vagas ${SLOT + 1} ou mais.`);
  return token;
}

/** Conta deste VU numa lista (`SharedArray`): cada VU fica com uma conta diferente, sem repetir. */
export function contaDoVu(lista, deslocamento = 0) {
  const indice = exec.vu.idInTest - 1 - deslocamento;
  if (indice < 0 || indice >= lista.length) {
    throw new Error(`Faltam contas: o VU ${exec.vu.idInTest} precisa da conta ${indice + 1}, mas dados/sessoes.json tem ${lista.length}. Rode preparar-dados.mts com mais contas.`);
  }
  return lista[indice];
}

function refreshNoJar() {
  const cookies = http.cookieJar().cookiesForURL(REFRESH_URL);
  return (cookies.na_rt || [])[0];
}

/**
 * Garante que o VU está com uma sessão válida da `conta`. Na primeira vez usa o token da vaga; depois renova a
 * cada 10 min com o refresh que a própria API devolveu. Devolve `false` se a API recusou (conta sem sessão).
 */
export function garantirSessao(conta) {
  const original = tokenDaVaga(conta);
  const jar = http.cookieJar();
  if (contaAtual !== original) {
    // Troca de conta no mesmo VU: guarda o refresh da conta anterior e recomeça o cookie jar.
    if (contaAtual && estado[contaAtual]) estado[contaAtual].refresh = refreshNoJar() || estado[contaAtual].refresh;
    jar.clear(BASE_URL);
    const salvo = estado[original];
    jar.set(BASE_URL, 'na_rt', salvo ? salvo.refresh : original, { path: '/api/v1/auth' });
    contaAtual = original;
    if (salvo) salvo.renovadoEm = 0; // o token de acesso foi junto com o jar: renova já
  }
  const s = (estado[original] = estado[original] || { refresh: original, renovadoEm: 0, ativa: false });
  if (s.ativa && s.renovadoEm && Date.now() - s.renovadoEm < RENOVAR_A_CADA_MS) return true;
  const res = http.post(REFRESH_URL, null, { headers: baseHeaders({ Accept: 'application/json', Origin: BASE_URL }), tags: { tipo: 'escrita', nome: 'auth/refresh' } });
  s.ativa = check(res, { 'sessão renovada': (r) => r.status === 200 });
  if (s.ativa) {
    s.renovadoEm = Date.now();
    s.refresh = refreshNoJar() || s.refresh;
  }
  return s.ativa;
}
