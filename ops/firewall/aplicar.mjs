#!/usr/bin/env node
/**
 * Aplica as regras versionadas do Vercel Firewall (`ops/firewall/regras.json`, issue #113) pela API REST da Vercel.
 *
 *   node ops/firewall/aplicar.mjs                       # SIMULAÇÃO (padrão): mostra o que mudaria, não grava nada
 *   node ops/firewall/aplicar.mjs --aplicar             # grava as regras (insere novas, atualiza as de mesmo nome)
 *   node ops/firewall/aplicar.mjs --aplicar --modo-log  # 1º estágio: toda regra só registra (log), nada bloqueia
 *   node ops/firewall/aplicar.mjs --aplicar --liberar-carga   # liga a exceção do gerador de carga (k6)
 *
 * Variáveis: `VERCEL_TOKEN` (token com acesso ao projeto), `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` (quando o projeto é
 * de um time). Para `--liberar-carga`: `CARGA_K6_IP` (IP público do gerador), `CARGA_K6_SEGREDO` (valor aleatório que
 * o k6 manda no cabeçalho `x-carga-k6`) e `CARGA_K6_HOST` (host do staging). Sem essas três, a regra do k6 fica
 * desligada e com valores que não casam com nada.
 *
 * Regras que existem no painel e não estão no arquivo **não são apagadas** (o script avisa). Quem aplica é o dono do
 * projeto; siga o rollout em estágios de `docs/seguranca.md` § Vercel Firewall (log → preview → produção).
 * Attack Challenge Mode não é aplicado por aqui: liga-se no painel (Firewall → Attack Challenge Mode) na hora do ataque.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = new Set(process.argv.slice(2));
const APLICAR = args.has('--aplicar');
const MODO_LOG = args.has('--modo-log');
const LIBERAR_CARGA = args.has('--liberar-carga');

const arquivo = join(dirname(fileURLToPath(import.meta.url)), 'regras.json');
const { rules } = JSON.parse(readFileSync(arquivo, 'utf8'));

const env = process.env;
const faltando = ['VERCEL_TOKEN', 'VERCEL_PROJECT_ID'].filter((k) => !env[k]);
if (LIBERAR_CARGA) faltando.push(...['CARGA_K6_IP', 'CARGA_K6_SEGREDO', 'CARGA_K6_HOST'].filter((k) => !env[k]));

/** Troca `${NOME}` pelo valor da variável; sem ela, um valor que nunca casa (a regra fica inofensiva). */
function preencher(valor) {
  if (typeof valor === 'string') return valor.replace(/\$\{([A-Z0-9_]+)\}/g, (_, nome) => env[nome] || `__sem_${nome.toLowerCase()}__`);
  if (Array.isArray(valor)) return valor.map(preencher);
  if (valor && typeof valor === 'object') return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, preencher(v)]));
  return valor;
}

function preparar(regra) {
  const r = preencher(regra);
  const ehCarga = regra.name.startsWith('Liberar gerador de carga');
  if (ehCarga) r.active = LIBERAR_CARGA;
  if (MODO_LOG && !ehCarga) {
    const m = r.action.mitigate;
    if (m.action === 'rate_limit') m.rateLimit = { ...m.rateLimit, action: 'log' };
    else if (m.action !== 'bypass') r.action = { mitigate: { ...m, action: 'log', actionDuration: null } };
  }
  return r;
}

function resumo(r) {
  const m = r.action.mitigate;
  const acao = m.action === 'rate_limit' ? `rate_limit ${m.rateLimit.limit}/${m.rateLimit.window}s por ${m.rateLimit.keys.join('+')} → ${m.rateLimit.action}` : m.action;
  return `${r.active ? 'ligada   ' : 'desligada'} · ${acao}`;
}

const API = 'https://api.vercel.com';
const qs = () => `projectId=${encodeURIComponent(env.VERCEL_PROJECT_ID)}${env.VERCEL_TEAM_ID ? `&teamId=${encodeURIComponent(env.VERCEL_TEAM_ID)}` : ''}`;

async function chamar(metodo, caminho, corpo) {
  const res = await fetch(`${API}${caminho}?${qs()}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${env.VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await res.text();
  if (!res.ok) throw new Error(`${metodo} ${caminho}: ${res.status} ${texto.slice(0, 300)}`);
  return texto ? JSON.parse(texto) : null;
}

const regras = rules.map(preparar);

if (!APLICAR) {
  console.log(`SIMULAÇÃO — nada foi gravado. ${regras.length} regras em ${arquivo}${MODO_LOG ? ' (modo log)' : ''}:\n`);
  for (const r of regras) console.log(`  · ${r.name.padEnd(42)} ${resumo(r)}`);
  if (faltando.length) console.log(`\nPara aplicar de verdade, defina: ${faltando.join(', ')} e rode com --aplicar.`);
  else console.log('\nVariáveis presentes. Para gravar: --aplicar (e confira o painel depois).');
  process.exit(0);
}

if (faltando.length) {
  console.error(`Faltam variáveis: ${faltando.join(', ')}.`);
  process.exit(2);
}

const ativa = await chamar('GET', '/v1/security/firewall/config/active');
const existentes = new Map((ativa?.rules ?? []).map((r) => [r.name, r]));
for (const r of regras) {
  const atual = existentes.get(r.name);
  if (atual) {
    await chamar('PATCH', '/v1/security/firewall/config', { action: 'rules.update', id: atual.id, value: r });
    console.log(`  ↻ atualizada: ${r.name} (${resumo(r)})`);
  } else {
    await chamar('PATCH', '/v1/security/firewall/config', { action: 'rules.insert', id: null, value: r });
    console.log(`  + criada:     ${r.name} (${resumo(r)})`);
  }
  existentes.delete(r.name);
}
for (const nome of existentes.keys()) console.log(`  ! no painel, fora do arquivo (não mexi): ${nome}`);
console.log('\nPronto. Confira em Vercel → Firewall → Rules e acompanhe o tráfego de cada regra nas primeiras 24 h.');
