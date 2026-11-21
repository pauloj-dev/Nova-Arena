# Operação — observabilidade e alertas (issue #116, plano R2.4, PRD RNF-14)

Como enxergar o que acontece em produção e quem é avisado quando algo sai da meta. Para **agir** num incidente, use o
[`docs/runbook.md`](runbook.md). Segurança: [`docs/seguranca.md`](seguranca.md).

> Tudo o que depende de conta (Sentry, log drain, alertas da Vercel, canal do time) fica **preparado no código** e
> listado no [checklist do dono](#checklist-do-dono). Nada aqui foi ligado a um serviço real durante o desenvolvimento.

## O que existe no código

| Peça | Onde | O que faz |
|---|---|---|
| Logs estruturados | `packages/api/src/logger.ts`, `app.ts` | Uma linha JSON por evento, sempre com `requestId`, `service: "api"`, `region` e `release` (quando na Vercel). Cada requisição gera `requisição` (método, caminho, status, `durationMs`); acima da meta do RNF-02 gera também `requisição acima da meta` (`warn`). Nunca senha, token, cookie, código de sala nem corpo. |
| ID da requisição | `X-Request-Id` na resposta | O mesmo id do log e do evento no Sentry: é por ele que se acha a linha de uma reclamação. |
| OpenTelemetry | `apps/web/instrumentation.ts` (`@vercel/otel`, serviço `nova-arena`) | Spans das funções (rotas, renderização, `fetch` de saída). Na Vercel aparecem em Observability; um *trace drain* manda para fora. |
| Sentry — navegador | `apps/web/instrumentation-client.ts`, `app/error.tsx` | Só com `NEXT_PUBLIC_SENTRY_DSN`; baixado sob demanda (fora do JS inicial). Envio pelo túnel `/monitoring` (mesmo domínio). |
| Sentry — servidor | `apps/web/instrumentation.ts` (`onRequestError`) | Erros de renderização e rotas do Next. Só com `SENTRY_DSN`. |
| Sentry — API e jobs | `apps/web/app/api/v1/[[...route]]/route.ts` → `reportError` (`packages/api/src/app.ts`, `jobs/runner.ts`) | Todo 500 da API e toda falha de job (QStash e Cron), com `requestId`/`job` como contexto e a etiqueta `area: api` ou `area: job`. |
| Privacidade no Sentry | `apps/web/shared/observability/sentry-options.ts` | `sendDefaultPii: false`; `beforeSend` tira cookies, `Authorization`, corpo, *query string*; do usuário só o `id`. Sem *session replay*. |
| Batimento do Cron | `packages/api/src/jobs/runner.ts` | Cada Cron que termina bem registra `cron ok` no log e a hora no Redis (`cron:last:<job>`). |
| Falhas de job | `job_failures` + `POST /jobs/failures` (QStash) | Mensagem que esgotou as tentativas vira falha em aberto na Saúde do Sistema. |
| Saúde do Sistema | `/admin/saude` (`GET /api/v1/admin/health`) | Banco, cache, filas, tempo real, arquivos, e-mail, **monitoramento de erros** (erros no Sentry na última hora) e **Cron** (fica "fora" se a varredura não roda há mais de 5 min). |
| Saúde pública | `GET /api/v1/health` | Banco, Redis e QStash; 503 se algo configurado está fora. Usada pelo smoke e por monitor externo. |
| Speed Insights | `apps/web/shared/privacy/Measurement.tsx` | LCP/INP/CLS reais (p75), sem cookies, sempre ligado. |
| Analytics | idem | Páginas visitadas, sem cookies, **só com o "sim" do banner** (LGPD). |
| Smoke pós-deploy | `ops/smoke/smoke.mjs`, `.github/workflows/smoke.yml` | Páginas, headers, `/health` depois de cada deploy. |

## Variáveis

| Variável | Onde | Para quê |
|---|---|---|
| `SENTRY_DSN` | servidor | Liga o Sentry nas funções (Next, API, jobs). Sem ela nada é carregado nem enviado. |
| `NEXT_PUBLIC_SENTRY_DSN` | build | Liga o Sentry no navegador e o túnel `/monitoring`. |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | build e servidor | Envio dos *source maps* no build e leitura da contagem de erros para a Saúde do Sistema (escopo `project:read` basta para a leitura; o de *releases* para os mapas). |
| `SENTRY_API_URL` | servidor | Só para Sentry auto-hospedado ou região própria (padrão `https://sentry.io`). |

A integração do Sentry vem pelo Marketplace da Vercel (cria `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` e o token). O
`@vercel/otel` não precisa de variável na Vercel; fora dela, use as `OTEL_EXPORTER_OTLP_*` padrão.

## Alertas

Meta de cada alerta: dispara, chega ao **canal do time** (Slack/Discord ou e-mail do plantão) e aponta para a seção do
runbook. Critério de aceite da #116: **cada alerta disparado em teste** (coluna "Como testar") — fica com o dono,
porque precisa das contas.

| Alerta | Condição | Onde configurar | Runbook | Como testar |
|---|---|---|---|---|
| **Erro > 1%** | Taxa de respostas 5xx das funções > 1% em 5 min (Vercel Observability → Alerts → *Error rate*). Reforço: alerta de métrica no Sentry "número de erros > N em 5 min" (N ≈ 1% do tráfego do beta) | Vercel e Sentry | [Pico de erros no Sentry](runbook.md#pico-de-erros-no-sentry) | No preview: rota de teste que lança erro (ou `DATABASE_URL` inválida num preview) e 100 requisições; conferir o aviso no canal |
| **Latência acima da meta** | p95 das funções > 300 ms (GET) ou > 600 ms (escrita) por 10 min (Vercel Observability → Alerts → *Function duration*). No log drain: mais de 5% das linhas `requisição` com `requisição acima da meta` em 10 min. Web: Speed Insights com LCP p75 > 2,5 s ou INP p75 > 200 ms no dia | Vercel (Observability e Speed Insights) e log drain | [Neon lento](runbook.md#neon-lento-banco) | k6 (`ops/k6`) com `ESCALA` alta contra o staging até passar da meta |
| **Falha no QStash** | Qualquer chamada a `/jobs/failures` (mensagem esgotou as tentativas) → linha `job falhou` + `job_failures`; Sentry com `area: job`; no console do QStash, alerta de DLQ não vazia | Sentry (regra "area = job"), QStash (console → DLQ), log drain | [QStash com falhas](runbook.md#qstash-com-falhas-jobs) | Publicar no QStash uma mensagem para `/jobs/matches/check-in` com corpo inválido assinado; ver a falha na Saúde e o aviso |
| **Cron sem rodar** | Nenhuma linha `cron ok` com `job: "cron:sweep"` em 5 min (alerta por **ausência** no log drain); Saúde do Sistema com o card "Cron" fora; Vercel → Cron Jobs com execução falhando | Log drain (Better Stack/Datadog/Axiom, consulta de ausência) e Vercel | [Cron sem rodar](runbook.md#cron-sem-rodar) | No staging, desabilitar o Cron em Vercel → Cron Jobs por 6 min |
| Saúde pública fora | `GET /api/v1/health` diferente de 200 por 2 min | Monitor externo (Better Stack, Checkly ou o Uptime da Vercel) | [Primeiro minuto](runbook.md#primeiro-minuto) | Apontar o monitor para um preview com `DATABASE_URL` errada |

Regras gerais:
- Todo alerta tem dono de plantão e uma seção no runbook. Alerta que dispara sem ação necessária é ajustado (limite
  ou janela), não ignorado.
- Durante as 2 semanas depois do cadastro público (plano R2.5), o limite de erro cai para 0,5% (critério da etapa).

## Logs: o que procurar

| Pergunta | Consulta (log drain ou Vercel → Logs) |
|---|---|
| O que aconteceu com a requisição X? | `requestId = "<X-Request-Id>"` |
| Quais rotas estão lentas? | `msg = "requisição acima da meta"` agrupado por `route` |
| O Cron está rodando? | `msg = "cron ok"` e `job = "cron:sweep"` nos últimos minutos |
| Jobs falhando? | `msg = "job falhou"` agrupado por `job` |
| Erros inesperados | `level = "error"` e `msg = "erro inesperado"` |
| Antifraude | `msg = "antifraude: ações administrativas em massa"` |
| LGPD | `msg = "conta excluída (LGPD)"` (só o id, nunca o e-mail) |

## Saúde do Sistema × Sentry

A tela mostra **quantos erros o Sentry recebeu na última hora** (card "Monitoramento de erros" e o número no resumo),
lido da API de estatísticas do projeto (`packages/api/src/observability.ts`). A **taxa** de erro (erros ÷ requisições)
não é calculada pela API — ela vem da Vercel (Observability) e dos alertas acima; o campo `errorRate` da Saúde fica
nulo até haver uma fonte de requisições. **Não validado com conta real**: se o formato da API do Sentry mudar, a tela
mostra "sem dados", nunca quebra.

## Checklist do dono

- [ ] Integração **Sentry** pelo Marketplace (projeto Next.js), com `SENTRY_ORG`, `SENTRY_PROJECT` e um token de
      leitura (`project:read`) para a Saúde do Sistema. Conferir no primeiro deploy: um erro de teste chega com o
      `release` e sem cookies.
- [ ] Regras de alerta no Sentry: "erros > N em 5 min" e "area = job" → canal do time.
- [ ] **Log drain** (Vercel → Settings → Log Drains) para o serviço escolhido; consultas salvas da tabela acima e os
      alertas de latência e de ausência do `cron ok`.
- [ ] **Trace drain** (opcional) para o mesmo serviço, se ele aceitar OpenTelemetry.
- [ ] Vercel Observability → Alerts: taxa de erro > 1% e duração p95 acima da meta, com o canal do time.
- [ ] **Speed Insights** e **Web Analytics** ligados no projeto (aba de cada um).
- [ ] Monitor externo para `GET /api/v1/health`.
- [ ] Disparar cada alerta uma vez (coluna "Como testar") e registrar data e print na issue #116.
