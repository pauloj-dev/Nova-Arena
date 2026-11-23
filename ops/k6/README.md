# Teste de carga com k6 (issue #112)

Valida a escala antes do beta (PRD RNF-01 a RNF-04, plano R2 "Testes"): **5.000 usuários simultâneos em 50
campeonatos ativos**, um **campeonato de 1.024 participantes de ponta a ponta** e **2.000 conexões de tempo real**.

> Só em **staging** (ou num preview dedicado). Nunca em produção: os scripts recusam um `BASE_URL` que não pareça
> staging/preview, e `preparar-dados.mts` recusa rodar sem `CARGA_CONFIRMO_STAGING=1` ou com `VERCEL_ENV=production`.

## Arquivos

| Arquivo | O que faz |
|---|---|
| `preparar-dados.mts` | Cria no banco do staging as contas de carga (`Carga00001…`, e-mails `@carga.novaarena.test`), os IDs de jogo e as sessões. Grava os refresh tokens em `dados/sessoes.json` (ignorado pelo git). |
| `montar-campeonatos.js` | Cria os 50 campeonatos ativos (32 inscritos cada, chave confirmada, 1ª rodada agendada). |
| `carga-geral.js` | 5.000 usuários: 4.000 visitantes, 950 jogadores logados acompanhando ao vivo, 50 VUs da organização lançando resultados. |
| `campeonato-1024.js` | Campeonato de 1.024 vagas: inscrição simultânea, chave, check-in e resultados até a final. |
| `tempo-real.js` | 2.000 conexões WebSocket ao Ably com o token da nossa API, assinando os canais dos campeonatos. |
| `lib/` | Configuração e metas (`config.js`), requisições marcadas por tipo (`http.js`), sessão sem login (`sessao.js`), passos da organização (`campeonato.js`). |

### Por que as sessões são preparadas no banco

O cadastro passa pelo BotID e o login aceita **5 tentativas por minuto por IP** (RNF-07). Milhares de VUs saindo de
poucas máquinas nunca entrariam por ali — e é assim que tem de ser. `preparar-dados.mts` abre as sessões como a API
faz (`startSession`: só o hash SHA-256 do refresh token no banco) e cada VU entra com `POST /auth/refresh`, como o
navegador. O refresh gira a cada uso e o reuso de um token já trocado derruba a família inteira, então:

- cada execução do k6 gasta uma **vaga** da sessão (`-e SLOT=0`, `1`, `2`…; `--vagas` define quantas existem);
- dois testes rodando ao mesmo tempo precisam de vagas diferentes (ex.: `carga-geral` com `SLOT=1` e
  `tempo-real` com `SLOT=2`);
- para rodar de novo, prepare de novo (rápido e idempotente: reaproveita as contas e abre sessões novas).

## Antes de rodar

1. **Staging no ar** com a API real (`NEXT_PUBLIC_API_MOCK=none`), Ably, Redis e QStash configurados
   (`GET /api/v1/health` com tudo `ok`). Seed do catálogo (`SEED_PROFILE=staging`).
2. **Bypass da proteção de deploy:** Vercel → Settings → Deployment Protection → *Protection Bypass for Automation*.
   O segredo vai em `-e VERCEL_AUTOMATION_BYPASS_SECRET=...` (o k6 manda `x-vercel-protection-bypass`).
3. **Liberar o gerador no Firewall:** sem isso os limites da borda (Vercel Firewall) devolvem 429 e o teste mede o
   bloqueio, não o sistema. A regra `Liberar gerador de carga (k6)` de `ops/firewall/regras.json` pula as outras
   só para o IP do gerador, com um cabeçalho secreto e no host do staging:
   ```bash
   export CARGA_K6_IP=<ip público da máquina do k6> CARGA_K6_HOST=staging.novaarena.gg
   export CARGA_K6_SEGREDO=$(node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))")
   VERCEL_TOKEN=... VERCEL_PROJECT_ID=... VERCEL_TEAM_ID=... node ops/firewall/aplicar.mjs --aplicar --liberar-carga
   ```
   Passe o mesmo segredo ao k6 (`-e CARGA_K6_SEGREDO=$CARGA_K6_SEGREDO`). **Ao terminar, rode de novo sem
   `--liberar-carga`** (a regra volta a ficar desligada). Os limites por IP da própria API (login, cadastro, eventos)
   não afetam estes scripts: eles não fazem login nem cadastro.
4. **Dados:**
   ```bash
   CARGA_CONFIRMO_STAGING=1 DATABASE_URL='<url sem pooler do branch staging do Neon>' \
     pnpm --filter @nova/db exec tsx ../../ops/k6/preparar-dados.mts --participantes 6000 --organizadores 6 --vagas 4
   ```
5. **k6** 0.50 ou mais novo (`brew install k6`). Para 5.000 VUs, uma máquina com 8 vCPU e 16 GB (ou k6 Cloud /
   duas máquinas dividindo a carga com `-e ESCALA=0.5` em cada). Suba o limite de arquivos abertos: `ulimit -n 65535`.
6. Avise o time: durante o teste o staging fica lento e os alertas do Sentry e da Vercel vão disparar.

## Rodar

Sempre comece com um **ensaio pequeno** (`-e ESCALA=0.02`) para conferir que nada quebra antes da carga cheia.

```bash
export BASE_URL=https://staging.novaarena.gg
export BYPASS=<segredo do bypass>

# 1) 50 campeonatos ativos (vaga 0)
k6 run -e BASE_URL=$BASE_URL -e VERCEL_AUTOMATION_BYPASS_SECRET=$BYPASS -e SLOT=0 ops/k6/montar-campeonatos.js

# 2) carga geral (vaga 1) — ~22 min com os padrões (subida 5 min, platô 15 min, descida 2 min)
k6 run -e BASE_URL=$BASE_URL -e VERCEL_AUTOMATION_BYPASS_SECRET=$BYPASS -e SLOT=1 \
  --summary-export ops/k6/dados/carga-geral.json ops/k6/carga-geral.js

# 3) tempo real, junto com a carga geral ou sozinho com eventos (vaga 2)
k6 run -e BASE_URL=$BASE_URL -e VERCEL_AUTOMATION_BYPASS_SECRET=$BYPASS -e SLOT=2 -e EVENTOS=1 \
  --summary-export ops/k6/dados/tempo-real.json ops/k6/tempo-real.js

# 4) campeonato de 1.024 (vaga 3) — ~55 min
k6 run -e BASE_URL=$BASE_URL -e VERCEL_AUTOMATION_BYPASS_SECRET=$BYPASS -e SLOT=3 \
  --summary-export ops/k6/dados/campeonato-1024.json ops/k6/campeonato-1024.js
```

Variáveis úteis: `ESCALA` (fração da carga), `SUBIDA`/`PLATO`/`DESCIDA` (carga geral, em minutos: `5m`),
`CONEXOES`, `SUBIDA_S`, `MANTER_S` (tempo real), `VAGAS` (campeonato), `PREFIXO` (nome dos campeonatos, padrão
`Carga k6`), `SESSOES` (outro arquivo de sessões), `ABLY_REST`/`ABLY_WS` (endpoints do Ably).

Ensaio local contra o servidor de desenvolvimento com a API real (sem Ably): `-e BASE_URL=http://localhost:3151 -e ESCALA=0.01`.

Ao terminar:

```bash
CARGA_CONFIRMO_STAGING=1 DATABASE_URL='<staging>' pnpm --filter @nova/db exec tsx ../../ops/k6/preparar-dados.mts --revogar
```

e desligue a regra de liberação do gerador no Firewall (`node ops/firewall/aplicar.mjs --aplicar`, sem `--liberar-carga`). Os campeonatos `Carga k6 …` podem ser cancelados pelo
painel Admin (ou o branch de staging do Neon recriado a partir de produção sem dados pessoais).

## Como ler o resultado

O resumo do k6 mostra cada métrica com ✓/✗ na meta. O que importa:

| Métrica | Meta | O que significa quando falha |
|---|---|---|
| `http_req_duration{tipo:leitura}` p(95) | ≤ 300 ms | Leitura da API lenta: consulta sem índice, cache da borda não pegando (`x-vercel-cache: MISS` sempre), função fria. |
| `http_req_duration{tipo:escrita}` p(95) | ≤ 600 ms | Escrita lenta: transação longa, disputa de linha (inscrição, resultado), fila. |
| `http_req_duration{tipo:pagina}` p(95) | ≤ 1 s (informativa) | Página fora do ISR/CDN. |
| `http_req_failed` | < 1% | Erros em geral (4xx inesperado ou 5xx). |
| `erros_servidor` | 0 | **Qualquer 5xx.** Procure no Sentry e nos logs pelo `X-Request-Id`. Erro de conexão no banco aparece aqui. |
| `limitados_429` | 0 | O gerador foi barrado (Firewall ou rate limit): o IP não foi liberado. Refaça; o resultado não vale. |
| `checks` | > 99% | Respostas com status ou corpo inesperado. |
| `inscricoes_confirmadas` | = vagas | CT-02: nenhuma vaga a mais nem a menos com 1.024 inscrições simultâneas. |
| `ably_conectou` / `ably_conexao_ms` | > 99% / p95 ≤ 2 s | Conexões recusadas (limite do plano do Ably) ou lentas. |
| `ably_atraso_evento_ms` p(95) | ≤ 2 s | Do resultado salvo ao evento no navegador (inclui a diferença de relógio da máquina do k6). |

Separe por rota com `--out json=ops/k6/dados/bruto.json` ou no k6 Cloud pelo tag `nome`. Cruze com:

- **Vercel → Observability:** duração e erros por função, *cold starts*, concorrência; **Speed Insights** não conta
  aqui (é tráfego sintético).
- **Neon → Monitoring:** conexões (o pooler aguenta ~10.000 clientes; o Postgres por trás, bem menos), CPU,
  *autoscaling* (subiu até o máximo?), consultas lentas (`pg_stat_statements`).
- **Upstash:** comandos por segundo e latência do Redis; mensagens e falhas no QStash.
- **Ably → Stats:** conexões, canais e mensagens por segundo; erros de limite.

## Custos estimados (por execução completa, preços de referência — confira nos painéis antes)

| Serviço | O que consome | Estimativa |
|---|---|---|
| Vercel (Pro) | ~1,5–3 milhões de requisições, horas de função (Fluid), transferência | dentro da franquia do Pro na maioria das execuções; o excedente de invocações e CPU é centavos de dólar por milhão |
| Neon | horas de *compute* no pico (autoscaling até o máximo configurado) | ~1–2 h de CU no máximo do autoscaling |
| Upstash Redis | ~2–5 milhões de comandos (cache e rate limit) | pago por comando: alguns dólares |
| QStash | mensagens dos jobs disparados pelos resultados | baixo (milhares de mensagens) |
| Ably | 2.000 conexões por ~12 min + mensagens (cada evento × assinantes) | o plano gratuito não comporta 2.000 conexões simultâneas: precisa de um plano pago (ou um *trial* de pico combinado com o Ably) |
| k6 Cloud (opcional) | VUh | 5.000 VUs × 0,4 h ≈ 2.000 VUh |

## Relatório de gargalos (preencher a cada execução)

Copie para a issue #112 (ou um comentário dela) com o resumo do k6 anexado.

```markdown
### Execução <data> — commit <sha> — staging

- Cenário: carga geral / 1.024 / tempo real · ESCALA: · duração:
- Resultado das metas: leitura p95 = ___ ms · escrita p95 = ___ ms · erro = ___% · 5xx = ___ · 429 = ___
- Rotas mais lentas (p95): 1. ___ 2. ___ 3. ___
- Banco: conexões no pico ___ · CPU ___ · CU máximo ___ · consulta mais lenta ___
- Redis/QStash: ___ · Ably: conexões ___ · erros ___
- Gargalos encontrados e causa provável:
- Ações (issue aberta para cada uma):
- Custo observado da execução: Vercel ___ · Neon ___ · Upstash ___ · Ably ___
- Ajuste do autoscaling do Neon para o pico das finais (mínimo/máximo de CU): ___
```

## Limitações conhecidas

- A sessão vem pronta do banco: o fluxo de login (Argon2id, ~50 ms de CPU por tentativa) não é medido sob carga.
  Para medi-lo, rode um cenário separado com poucas contas reais e a regra do Firewall liberada.
- O W.O. automático, os jobs do QStash e o Cron rodam no ritmo real; o teste não acelera o relógio.
- `ably_atraso_evento_ms` depende do relógio da máquina do k6 estar sincronizado (NTP).
- Nenhum destes scripts foi executado contra serviços externos neste repositório: foram revisados contra as rotas
  reais (`packages/api/src/modules/*`). A primeira execução em staging deve começar pelo ensaio com `ESCALA=0.02`.
