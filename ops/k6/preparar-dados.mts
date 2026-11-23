/**
 * Prepara o staging para o teste de carga (issue #112): contas de carga, IDs de jogo e sessões abertas.
 *
 * Por que direto no banco: o cadastro passa pelo BotID e o login aceita 5 tentativas por minuto por IP (RNF-07).
 * Milhares de contas não entram por ali, e é assim que tem de ser em produção. Este script cria as contas e abre
 * uma sessão (família de refresh token) para cada uma, exatamente como `startSession` faz: só o hash SHA-256 do
 * refresh token vai para o banco; o token em si fica em `ops/k6/dados/sessoes.json` (ignorado pelo git).
 *
 * Uso (da raiz do repositório, com a URL **sem pooler** do branch de staging do Neon):
 *
 *   CARGA_CONFIRMO_STAGING=1 DATABASE_URL='<url do staging>' \
 *     pnpm --filter @nova/db exec tsx ../../ops/k6/preparar-dados.mts --participantes 6000 --organizadores 6
 *
 * Opções: `--participantes N` (padrão 6000) · `--organizadores N` (padrão 6) · `--assentos-por-organizador N`
 * (padrão 20: VUs de organização que podem agir ao mesmo tempo pela mesma conta) · `--vagas N` (padrão 3: quantas
 * execuções do k6 cada sessão aguenta; o refresh gira no primeiro uso, então cada execução usa uma vaga, `-e SLOT=n`)
 * · `--revogar` (encerra todas as sessões das contas de carga e sai).
 *
 * Idempotente: rodar de novo reaproveita as contas e abre sessões novas (as antigas continuam válidas até vencer
 * ou até `--revogar`). Nunca roda com `VERCEL_ENV=production` nem sem `CARGA_CONFIRMO_STAGING=1`.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from '../../packages/db/src/client.ts';

const DOMINIO = 'carga.novaarena.test';
const REFRESH_TTL_MS = 30 * 24 * 3600 * 1000;

function opcao(nome: string, padrao: number): number {
  const i = process.argv.indexOf(`--${nome}`);
  if (i === -1) return padrao;
  const valor = Number(process.argv[i + 1]);
  if (!Number.isInteger(valor) || valor < 1) throw new Error(`--${nome} precisa de um número inteiro positivo.`);
  return valor;
}

if (process.env.VERCEL_ENV === 'production') throw new Error('Recusado: VERCEL_ENV=production. Teste de carga só em staging.');
if (process.env.CARGA_CONFIRMO_STAGING !== '1') throw new Error('Defina CARGA_CONFIRMO_STAGING=1 para confirmar que DATABASE_URL é o banco do staging (nunca produção).');
if (!process.env.DATABASE_URL) throw new Error('Defina DATABASE_URL (a URL sem pooler do branch de staging do Neon).');

const PARTICIPANTES = opcao('participantes', 6000);
const ORGANIZADORES = opcao('organizadores', 6);
const ASSENTOS = opcao('assentos-por-organizador', 20);
const VAGAS = opcao('vagas', 3);

const db = createDb({ connectionString: process.env.DATABASE_URL, max: 4 });
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const pad = (n: number, w: number) => String(n).padStart(w, '0');

async function revogar() {
  const { count } = await db.session.updateMany({
    where: { user: { email: { endsWith: `@${DOMINIO}` } }, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  console.log(`Sessões de carga encerradas: ${count}.`);
}

/** Valor de ID de jogo que passa nos padrões do catálogo (só dígitos, 9 caracteres) e é único por conta. */
function valorDoCampo(chave: string, indice: number, apelido: string): string {
  return /nick|name|nome/i.test(chave) ? apelido : `7${pad(indice, 8)}`;
}

async function contas(prefixo: string, quantidade: number, papeis: ('PARTICIPANT' | 'ORGANIZER')[]) {
  const dados = Array.from({ length: quantidade }, (_, i) => {
    const apelido = `${prefixo}${pad(i + 1, 5)}`;
    return { email: `${apelido.toLowerCase()}@${DOMINIO}`, nickname: apelido, nicknameKey: apelido.toLowerCase(), emailVerified: true, country: 'Brasil', bio: 'Conta do teste de carga.' };
  });
  for (let i = 0; i < dados.length; i += 1000) await db.user.createMany({ data: dados.slice(i, i + 1000), skipDuplicates: true });
  const usuarios = await db.user.findMany({ where: { email: { in: dados.map((d) => d.email) } }, select: { id: true, nickname: true, sessionVersion: true }, orderBy: { nickname: 'asc' } });
  const papeisDados = usuarios.flatMap((u) => papeis.map((role) => ({ userId: u.id, role })));
  for (let i = 0; i < papeisDados.length; i += 1000) await db.userRole.createMany({ data: papeisDados.slice(i, i + 1000), skipDuplicates: true });
  return usuarios;
}

async function sessoes(usuarios: { id: string; sessionVersion: number }[], porUsuario: number) {
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  const tokens = new Map<string, string[]>();
  const linhas = usuarios.flatMap((u) =>
    Array.from({ length: porUsuario }, () => {
      const token = randomBytes(32).toString('base64url');
      tokens.set(u.id, [...(tokens.get(u.id) ?? []), token]);
      return { userId: u.id, familyId: randomUUID(), refreshTokenHash: sha256(token), sessionVersion: u.sessionVersion, userAgent: 'nova-arena-k6/1.0', ip: 'k6', expiresAt };
    }),
  );
  for (let i = 0; i < linhas.length; i += 1000) await db.session.createMany({ data: linhas.slice(i, i + 1000) });
  return tokens;
}

async function main() {
  if (process.argv.includes('--revogar')) return revogar();

  const participantes = await contas('Carga', PARTICIPANTES, ['PARTICIPANT']);
  const organizadores = await contas('CargaOrg', ORGANIZADORES, ['PARTICIPANT', 'ORGANIZER']);
  // RN-10: o organizador comum tem 3 campeonatos ativos; o de carga precisa de folga para 50 campeonatos no total.
  for (const o of organizadores) {
    await db.organizerLimits.upsert({ where: { userId: o.id }, create: { userId: o.id, verified: true, maxActiveTournaments: 60 }, update: { verified: true, maxActiveTournaments: 60 } });
  }

  // IDs de jogo em todos os jogos ativos: a inscrição exige os campos obrigatórios do jogo.
  const jogos = await db.game.findMany({ where: { active: true }, select: { id: true, requiredAccountFields: true } });
  for (const jogo of jogos) {
    const campos = (jogo.requiredAccountFields as { key: string }[]).map((f) => f.key);
    const linhas = participantes.map((u, i) => ({ userId: u.id, gameId: jogo.id, fields: Object.fromEntries(campos.map((k) => [k, valorDoCampo(k, i + 1, u.nickname)])) }));
    for (let i = 0; i < linhas.length; i += 1000) await db.gameAccount.createMany({ data: linhas.slice(i, i + 1000), skipDuplicates: true });
  }

  const tokensParticipantes = await sessoes(participantes, VAGAS);
  const tokensOrganizadores = await sessoes(organizadores, ASSENTOS * VAGAS);

  const saida = {
    geradoEm: new Date().toISOString(),
    aviso: 'Refresh tokens de staging. Não commite, não compartilhe. Encerre com --revogar ao terminar.',
    vagas: VAGAS,
    participantes: participantes.map((u) => ({ userId: u.id, nickname: u.nickname, refreshTokens: tokensParticipantes.get(u.id) ?? [] })),
    // Um "assento" por VU de organização (o refresh gira a cada uso: VUs não podem dividir sessão). Os assentos
    // da mesma conta ficam juntos: `organizadores[0..ASSENTOS-1]` são todos de CargaOrg00001.
    assentosPorOrganizador: ASSENTOS,
    organizadores: organizadores.flatMap((u) => {
      const tokens = tokensOrganizadores.get(u.id) ?? [];
      return Array.from({ length: ASSENTOS }, (_, assento) => ({ userId: u.id, nickname: u.nickname, assento, refreshTokens: tokens.slice(assento * VAGAS, (assento + 1) * VAGAS) }));
    }),
  };
  const arquivo = join(dirname(fileURLToPath(import.meta.url)), 'dados', 'sessoes.json');
  mkdirSync(dirname(arquivo), { recursive: true });
  writeFileSync(arquivo, JSON.stringify(saida));
  console.log(`Pronto: ${participantes.length} participantes e ${organizadores.length} organizadores (${saida.organizadores.length} assentos), ${VAGAS} vagas por sessão, IDs de jogo em ${jogos.length} jogos.`);
  console.log(`Sessões gravadas em ${arquivo}.`);
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
