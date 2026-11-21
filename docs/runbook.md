# Runbook de incidentes (issue #117, plano R2.4, PRD RNF-05 e RNF-14)

O que fazer quando algo quebra em produção. Cada incidente segue o mesmo roteiro: **sintoma → como confirmar →
ação imediata → comunicação → pós-incidente**. Comece sempre pelo [Primeiro minuto](#primeiro-minuto).

> Ferramentas: Vercel (Deployments, Observability, Logs, Firewall), Sentry, Neon Console, Upstash Console
> (Redis e QStash), Ably Dashboard, Resend Dashboard, painel Admin → **Saúde do Sistema** (`/admin/saude`) e
> `GET /api/v1/health`. Alertas e limites: [`docs/operacao.md`](operacao.md). Segurança: [`docs/seguranca.md`](seguranca.md).

## Papéis

| Papel | Quem | Faz |
|---|---|---|
| **Responsável pelo incidente** | quem está de plantão (ou o primeiro que viu) | decide, executa ou delega; mantém a linha do tempo |
| **Comunicação** | outra pessoa, se houver | atualiza o banner do site, o canal do time e os organizadores afetados |
| **Dono do projeto** | dono da conta Vercel/Neon/Ably | únicas pessoas com acesso a faturamento, restauração de produção e rotação de segredos de produção |

Severidade: **S1** site fora ou dado errado em campeonato ao vivo · **S2** função importante degradada (tempo real,
e-mail, uploads) · **S3** incômodo sem perda (lentidão pontual, um job atrasado).

## Primeiro minuto

1. Abra `https://<domínio>/api/v1/health`: mostra banco, Redis e QStash (`ok`, `degraded` ou 503 com o que está fora).
2. Rode o smoke: `pnpm smoke https://<domínio>` (`ops/smoke/smoke.mjs`). Ele diz o que está quebrado em segundos.
3. Vercel → **Deployments**: houve deploy nos últimos 30 min? Se sim e o problema começou junto, vá direto para o
   [Rollback](#rollback-com-instant-rollback) — investigue depois.
4. Sentry → **Issues** ordenadas por "First seen": erro novo com pico?
5. Abra um fio no canal do time com: horário de início, sintoma, severidade, quem é o responsável.

## Comunicação (modelos)

- **Banner do site:** painel Admin → Comunicados → tipo *Manutenção* (aparece para todo mundo).
  - "Estamos com instabilidade em <função>. Os resultados já lançados estão salvos. Atualizamos aqui em até 30 min."
  - Resolvido: "Tudo normalizado. Se algo ficou estranho no seu campeonato, fale com a organização."
- **Organizadores com campeonato ao vivo:** Comunicados → público *Organizadores*. Diga o que não funciona e o
  contorno (ex.: "o placar ao vivo atualiza a cada 10 s enquanto o tempo real volta").
- Nunca publique causa técnica, nome de fornecedor em disputa, nem dado pessoal.

---

## Rollback com Instant Rollback

**Quando:** o problema começou com um deploy, ou não há diagnóstico em 5 min num S1. Meta: **site funcionando em
< 5 min** (critério da #117).

**Ação imediata:**
1. Vercel → Project → **Deployments** → o último deploy de produção **anterior** ao problema (status *Ready*) →
   menu `⋯` → **Instant Rollback** (ou na CLI: `vercel rollback <url-do-deploy-bom> --scope <time>`).
2. Confirme: `pnpm smoke https://<domínio>` passa e o Sentry para de receber o erro novo.
3. Enquanto o rollback valer, **os deploys automáticos da `main` não vão para produção** (a Vercel congela a
   promoção). Corrija numa branch, faça o deploy de preview, rode o smoke contra ele e só então promova
   (Deployments → *Promote to Production*) — isso desfaz o congelamento.

**Banco e rollback:** o Instant Rollback troca só o código; o banco continua na versão nova. Por isso **toda
migration é compatível com a versão anterior** (`docs/banco.md`: expandir → migrar → contrair; nunca remover ou
renomear coluna no mesmo PR que para de usá-la; índice grande com `CONCURRENTLY`). Se uma migration quebrou essa
regra e o código antigo não roda com o banco novo:
- não tente "desfazer" a migration à mão em produção;
- escreva uma migration nova que devolva a compatibilidade (ex.: recriar a coluna com padrão) e faça o deploy dela;
- em último caso, [restauração por ponto no tempo](#restauração-por-ponto-no-tempo-do-neon-pitr) (perde o que foi
  gravado depois do ponto escolhido).

**Testar (staging, a cada trimestre e antes do lançamento):** faça um deploy de staging com uma mudança visível,
rode o Instant Rollback, cronometre até o smoke passar, anote o tempo na issue #117. Meta < 5 min.

**Pós-incidente:** o PR que causou volta com teste que pegaria o problema; registre na linha do tempo.

---

## Ably fora (tempo real)

**Sintoma:** páginas ao vivo mostram "Reconectando… atualizando a cada 10 s"; resultados aparecem com até 10 s
de atraso; Saúde do Sistema mostra o Ably fora; logs com `falha ao publicar no Ably`.

**Como confirmar:** <https://status.ably.com>; Ably Dashboard → Stats (conexões caindo, erros 4xx/5xx); logs da
Vercel filtrando `falha ao publicar no Ably`. Erro `40160`/`40140` = problema de chave/token (nosso);
`42910`/limites = plano estourado (conexões ou mensagens).

**Ação imediata:**
- **Nada quebra de verdade:** a API grava tudo e só publica no Ably depois do commit; falha ao publicar vai para o
  log e as telas caem sozinhas no polling de 10 s (CT-10, ADR-005). Não reinicie nada.
- Limite do plano estourado: suba o plano no Ably Dashboard (dono do projeto) ou espere o pico passar.
- Chave revogada/errada: gere nova chave no Ably, troque `ABLY_API_KEY` na Vercel (Production) e faça
  **Redeploy** (variável nova só vale em deploy novo).
- Para desligar o tempo real de propósito (ex.: Ably instável derrubando conexões em loop), remova `ABLY_API_KEY`
  de Production e faça redeploy: a rota de token responde 503 `REALTIME_UNAVAILABLE` e as telas ficam no polling.
  (Não use `NEXT_PUBLIC_API_MOCK` em produção para isso: ele liga a API simulada.)

**Comunicação:** S2. Banner só se durar mais de 15 min em horário de campeonato.

**Pós-incidente:** quanto tempo durou, quantas conexões caíram, se o polling segurou a carga (Vercel → Observability:
pico de requisições em `/api/v1/stages/*/bracket` e `/matches`).

---

## QStash com falhas (jobs)

**Sintoma:** inscrições não abrem/fecham na hora, W.O. automático não aplicado, e-mails e push de notificação não
chegam; Saúde do Sistema lista **falhas de job** (`job_failures`); alerta "mensagens com falha no QStash".

**Como confirmar:** Upstash Console → QStash → **Logs/DLQ** (mensagens com erro, código de resposta da nossa rota);
`GET /api/v1/health` (QStash `down`?); <https://status.upstash.com>. Resposta 401 nas rotas `/api/v1/jobs/*` =
assinatura não confere (chaves de assinatura trocadas sem atualizar a Vercel).

**Ação imediata:**
- **O Cron cobre o essencial:** `/api/v1/cron/sweep` roda a cada minuto e abre/fecha inscrições na data, devolve
  squads incompletos à fila e aplica o W.O. atrasado. Confira em Vercel → Cron Jobs que ele está rodando.
- Nossa rota respondendo 5xx: é bug nosso — veja o erro no Sentry/logs pelo nome do job; corrija ou faça rollback.
  O QStash tenta de novo sozinho; quando esgotar, a falha fica na Saúde do Sistema.
- Assinatura (401): copie `QSTASH_CURRENT_SIGNING_KEY` e `QSTASH_NEXT_SIGNING_KEY` do console para a Vercel e redeploy.
- Depois de corrigir: no Upstash, **reenvie** as mensagens da DLQ (são idempotentes: `dedupId` estável e checagem
  de estado antes de agir, `docs/jobs.md`). Marque as falhas como resolvidas na Saúde do Sistema.
- E-mails/push perdidos: as notificações continuam na central do site; reenviar e-mail é opcional.

**Comunicação:** S3 se o Cron está cobrindo; S2 se check-in/W.O. de partida ao vivo ficou errado — avise a
organização do campeonato para conferir a partida (W.O. manual em `POST /matches/:id/walkover`).

**Pós-incidente:** quantas mensagens foram para a DLQ, se alguma ação ficou duplicada (não deveria), tempo até o Cron cobrir.

---

## Cron sem rodar

**Sintoma:** alerta "Cron sem rodar"; inscrições não abrem na data; suspensões vencidas não expiram
(`/api/v1/cron/sanctions`).

**Como confirmar:** Vercel → Project → **Cron Jobs** (última execução e status); logs filtrando `cron:sweep`;
`curl -H "Authorization: Bearer $CRON_SECRET" https://<domínio>/api/v1/cron/sweep` (deve dar 200).

**Ação imediata:** 401 → `CRON_SECRET` diferente entre a Vercel e o que a rota espera (troque e redeploy). Cron
desabilitado → reabilite em Cron Jobs (o plano precisa ser Pro para rodar por minuto). Rota quebrando → Sentry/logs
e rollback. Enquanto isso, rode a chamada acima à mão a cada poucos minutos.

---

## Neon lento (banco)

**Sintoma:** p95 da API acima de 300 ms (leitura) / 600 ms (escrita), timeouts, erros 500 com `P1001`/`P2024`
(conexão) nos logs, health com o banco lento ou `down`.

**Como confirmar:** Neon Console → **Monitoring** (CPU, conexões, *autoscaling* no máximo?) e **Query performance**
(consultas mais lentas); <https://neonstatus.com>; Vercel → Observability (duração por rota: é uma rota só ou todas?).

**Ação imediata:**
- **Autoscaling no teto:** suba o máximo de CU do branch de produção (Neon → Branch → Compute). Rápido e reversível.
- **Conexões esgotadas:** confirme que a aplicação usa a URL **com pooler** (`DATABASE_URL` com `-pooler`); a sem
  pooler é só para migrations. Uma instância por função com `max` baixo (`packages/db/src/client.ts`).
- **Uma consulta específica:** veja o plano (`EXPLAIN (ANALYZE, BUFFERS)` num branch do Neon criado a partir de
  produção, nunca em produção) e crie o índice numa migration nova com `CREATE INDEX CONCURRENTLY`.
- **Pico de tráfego:** as páginas públicas e as leituras públicas da API têm cache na borda (`s-maxage` +
  `stale-while-revalidate`); confirme `x-vercel-cache: HIT` nelas. Ataque/robô: [Firewall](#ataque-ou-tráfego-abusivo).
- **Neon fora (incidente deles):** não há o que fazer além de comunicar; o site mostra erro nas telas que leem o
  banco. Não faça restauração por causa de indisponibilidade.

**Comunicação:** S1 se o site está inutilizável; S2 se só lento.

**Pós-incidente:** consulta culpada + índice; ajuste do autoscaling registrado (#111); reteste de carga (#112) se
mudou algo estrutural.

---

## Redis (Upstash) fora

**Sintoma:** health com Redis `down`; erros 500 em leituras com cache (ex.: catálogo de jogos) e lentidão no login
(o limite de tentativas espera a resposta do Redis).

**Como confirmar:** Upstash Console → Redis → métricas e erros; <https://status.upstash.com>; logs com erros do
`@upstash/redis`.

**Ação imediata:** incidente do provedor → aguarde e comunique. Credencial errada/rotacionada → atualize
`KV_REST_API_URL`/`KV_REST_API_TOKEN` e redeploy. **Não** remova as variáveis para "desligar" o Redis em produção:
sem elas a API cai para o limite de tentativas em memória (por instância), o que enfraquece a proteção contra força
bruta (RNF-07). Se precisar fazer isso por horas, ligue antes o **Attack Challenge Mode** no Firewall.

**Pós-incidente:** avaliar falha aberta no cache (servir do banco quando o Redis não responde) — risco anotado em
`docs/seguranca.md`.

---

## Resend fora (e-mail)

**Sintoma:** e-mails de verificação, recuperação de senha e notificações não chegam; logs com erro do Resend; jobs
`notifications/email` falhando.

**Como confirmar:** Resend Dashboard → **Logs/Emails** (bounces, `rate_limited`, domínio não verificado);
<https://resend-status.com>.

**Ação imediata:** domínio perdeu a verificação (DNS) → corrija SPF/DKIM no DNS (`docs/email.md`). Limite de envio →
suba o plano. Chave rotacionada → atualize `RESEND_API_KEY` e redeploy. Os e-mails de notificação são reenviados
pelo QStash quando o serviço volta (idempotentes). Quem não recebeu a verificação pode pedir de novo na tela.

**Comunicação:** S2 (bloqueia cadastro novo). Banner: "E-mails podem atrasar; se o código não chegar, tente de novo
em alguns minutos."

---

## Pico de erros no Sentry

**Sintoma:** alerta "taxa de erro > 1%" (`docs/operacao.md`); Saúde do Sistema com a taxa de erro alta.

**Como confirmar:** Sentry → a issue com mais eventos na última hora: é front (navegador), função (API) ou job?
Começou com um deploy (*release*)? Afeta um navegador/aparelho só?

**Ação imediata:** começou com deploy → [rollback](#rollback-com-instant-rollback). Erro de um fornecedor → seção
dele acima. Erro de dado (contrato, `CONTRACT_VIOLATION`) → corrija o dado ou o código; nunca edite resultado
direto no banco (o histórico de resultados e a auditoria só aceitam inserção). Use o `X-Request-Id` do evento para
achar a linha de log da requisição.

**Pós-incidente:** teste de regressão para o erro; se o alerta demorou, ajuste o limite.

---

## Ataque ou tráfego abusivo

**Sintoma:** pico de 429, de requisições de poucos IPs, de cadastros/logins, CPU das funções disparando.

**Ação imediata:** Vercel → **Firewall** → *Attack Challenge Mode* (desafio para todo visitante; ligue e desligue
em segundos). Bloqueie IPs/ASN específicos com regra *Deny*. As regras versionadas estão em `ops/firewall/regras.json`
(aplicar com `node ops/firewall/aplicar.mjs --aplicar`). Detalhes em `docs/seguranca.md` § Vercel Firewall.

---

## Vazamento de segredo

**Sintoma:** segredo commitado (alerta do gitleaks no CI ou do GitHub Secret Scanning), log com valor sensível,
notebook/laptop perdido, ex-integrante com acesso, uso estranho num painel de fornecedor.

**Princípios:** trate como vazado assim que houver dúvida. **Rotacione primeiro, investigue depois.** Remover o
commit **não** basta (o histórico e os forks guardam): o valor antigo tem de deixar de valer. Toda variável é
cadastrada como *Sensitive* na Vercel e muda por ambiente — rotacione só o ambiente afetado, mas confirme se o mesmo
valor foi reaproveitado em outro.

**Ação imediata (geral):**
1. Gere o valor novo no provedor (ou com o comando do `.env.example`).
2. Vercel → Settings → Environment Variables → edite no(s) ambiente(s) afetado(s).
3. **Redeploy** de produção (Deployments → último → *Redeploy*): variável nova só vale em deploy novo.
4. Revogue o valor antigo no provedor (quando o provedor permite ter os dois, revogue só depois do redeploy).
5. Procure uso indevido no período (logs do provedor, auditoria do painel Admin).

**Por variável (`.env.example`):**

| Variável | Como rotacionar | Efeito colateral |
|---|---|---|
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | Neon → Roles → *Reset password* do papel da aplicação; a integração atualiza as variáveis (confira) | conexões abertas caem no redeploy |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Upstash → Redis → *Reset token* | cache e limites seguem (dados ficam) |
| `QSTASH_TOKEN` | Upstash → QStash → *Rotate token* | — |
| `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` | Upstash → QStash → *Roll signing keys*; copie as duas | mensagens em voo assinadas com a chave antiga ainda passam pela "próxima" durante a troca |
| `CRON_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` | nenhum (a Vercel manda o valor novo após o redeploy) |
| `BLOB_READ_WRITE_TOKEN`, `BLOB_PRIVATE_READ_WRITE_TOKEN` | Vercel → Storage → Blob → *Rotate token* | arquivos continuam; só o token muda |
| `EDGE_CONFIG`, `EDGE_CONFIG_ID`, `VERCEL_API_TOKEN`, `VERCEL_TEAM_ID` | Edge Config → novo *read token*; Account → Tokens → revogar e criar outro (escopo mínimo: o time, expiração) | flags param de gravar até trocar |
| `RESEND_API_KEY`, `EMAIL_FROM` | Resend → API Keys → criar nova, revogar a antiga | — |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | O DSN é público por natureza; se houver abuso (eventos falsos), Sentry → Client Keys → nova chave e desativar a antiga | eventos falsos param |
| `SENTRY_AUTH_TOKEN` | Sentry → Auth Tokens → revogar e criar (escopo de upload de *source maps*) | build sem *source maps* até trocar |
| `ABLY_API_KEY` | Ably → API Keys → criar nova com as mesmas capacidades, revogar a antiga | conexões abertas caem e reconectam (tokens novos) |
| `AUTH_JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` | **todas as sessões caem** (todo mundo entra de novo); quem tinha o segredo podia forjar sessão de qualquer um — revise a auditoria do período |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud Console → Credenciais → *Reset secret* | login com Google falha entre a troca e o redeploy |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | Discord Developer Portal → OAuth2 → *Reset Secret* | idem, para o Discord |
| `LOBBY_ENCRYPTION_KEY` | **Não basta trocar:** os códigos de sala salvos ficam ilegíveis. Gere a nova, faça deploy e peça à organização dos campeonatos ativos que cadastre de novo os códigos de sala | códigos de sala antigos perdidos |
| `TWO_FACTOR_ENCRYPTION_KEY` | **Trocar invalida o 2FA de todas as contas.** Só se vazou de fato; depois do redeploy, cada Admin configura o 2FA de novo (o acesso ao painel exige) | Admins sem painel até reconfigurar |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | `npx web-push generate-vapid-keys` | as inscrições de push existentes deixam de valer; o app pede de novo |
| `SEED_DEMO_PASSWORD` | Só fora de produção. Troque e rode o seed de novo; atualize `E2E_DEMO_PASSWORD` no GitHub | — |
| `VERCEL_AUTOMATION_BYPASS_SECRET` (GitHub) | Vercel → Deployment Protection → regenerar; atualize o segredo no GitHub | E2E e smoke dos previews falham até trocar |

**Segredo no repositório:** depois de rotacionar, remova o arquivo/linha num commit novo e marque o alerta como
resolvido (revogado). Reescrever o histórico só se o dono decidir — e não substitui a rotação.

**Comunicação:** interno. Se houver indício de acesso a dado pessoal: o dono do projeto avalia a comunicação à ANPD
e aos titulares (LGPD, art. 48) — registre a linha do tempo desde já.

**Pós-incidente:** como vazou; o gitleaks pegaria? (`.gitleaks.toml`); acessos revisados (membros da Vercel, do
GitHub e dos fornecedores).

---

## Restauração por ponto no tempo do Neon (PITR)

**Quando:** dado apagado ou corrompido por bug, migration destrutiva, ação errada de Admin que não tem desfazer.
**Não** use para indisponibilidade do Neon. O Neon guarda o histórico do branch pela **janela de restauração do
plano** (confira em Project → Settings → *History retention*; deixe pelo menos 7 dias em produção).

### Princípio: nunca restaurar às cegas

Primeiro **crie um branch a partir do ponto no tempo** e confira os dados nele. Só depois decida entre (a) copiar
os dados que faltam do branch para produção ou (b) restaurar o branch de produção inteiro.

### Passo a passo de teste em branch separada (fazer a cada trimestre e antes do lançamento — critério da #117)

1. **Marque o ponto:** num ambiente de staging (ou com o branch de produção, sem tocar nele), anote a hora UTC
   atual `T0`. Em staging, faça uma mudança conhecida depois de `T0` (ex.: cancele um campeonato de teste e apague
   uma conta de teste pelo fluxo normal).
2. **Crie o branch de restauração:** Neon Console → Branches → **Create branch** → *Parent*: o branch de produção (ou
   de staging) → *Include data up to*: **Specific date and time** = `T0` → nome `restore-teste-AAAAMMDD`.
   CLI: `neon branches create --project-id <id> --name restore-teste-AAAAMMDD --parent production --parent-timestamp 2026-01-01T12:00:00Z`.
3. **Conecte só leitura nele** (pegue a connection string do branch novo; nunca a de produção):
   ```bash
   psql "<url do branch restore-teste>" -c "SELECT now(), count(*) FROM users;"
   psql "<url do branch restore-teste>" -c "SELECT status FROM tournaments WHERE id = '<id do campeonato de teste>';"
   ```
   O campeonato precisa estar no estado de antes da mudança (não cancelado) e a conta de teste, inteira.
4. **Confira a integridade:**
   ```bash
   psql "<url>" -c "SELECT count(*) FROM audit_logs WHERE \"createdAt\" <= '<T0>';"   # bate com produção até T0
   psql "<url>" -c "SELECT count(*) FROM result_events;"
   pnpm --filter @nova/db exec prisma migrate status   # com DATABASE_URL=<url do branch>: nenhuma migration pendente além das posteriores a T0
   ```
5. **Suba o app contra o branch** (opcional, recomendado): um deploy de preview com `DATABASE_URL` apontando para o
   branch (Vercel → Env por branch de Git, ou localmente `NEXT_PUBLIC_API_MOCK=none` + a URL do branch) e rode
   `pnpm smoke <url>`.
6. **Cronometre e registre** na issue #117: hora do pedido, hora em que o branch ficou consultável, resultado das
   conferências, quem fez.
7. **Apague o branch** de teste (Neon → Branches → Delete): ele custa armazenamento e tem dados pessoais.

### Restauração de verdade

- **Poucos registros:** com o branch do ponto no tempo conferido, exporte só o que falta
  (`pg_dump --data-only --table=<tabela> --where`… ou `COPY (SELECT …) TO STDOUT`) e importe em produção numa
  transação, com a auditoria registrando o motivo. `audit_logs` e `result_events` só aceitam inserção: **não**
  tente regravar linhas existentes.
- **Banco inteiro:** Neon → Branch de produção → **Restore** → ponto no tempo (o Neon guarda o estado anterior num
  branch de backup automático, permitindo desfazer). Antes: banner de manutenção, Attack Challenge Mode/maintenance
  para segurar escritas, e anote `T_restore`. Tudo gravado depois do ponto escolhido **se perde** — exporte antes,
  do branch de backup, o que precisar reaplicar (inscrições, resultados).
- Depois: redeploy não é necessário (a URL do branch não muda), mas rode o smoke e confira `prisma migrate status`
  (migrations aplicadas depois do ponto voltam a ficar pendentes: o próximo deploy as aplica).

**Comunicação:** S1. Avise organizadores dos campeonatos afetados com o horário exato do ponto restaurado.

**Pós-incidente:** por que o dado se perdeu; o que impede de novo (confirmação dupla, *soft delete*, permissão).

---

## Depois de todo incidente

- Linha do tempo (UTC) no fio do canal: início, detecção, ações, fim.
- Em até 2 dias úteis: post-mortem curto e sem culpados — o que aconteceu, impacto (usuários, campeonatos,
  duração), causa, o que funcionou, o que melhorar, issues abertas com dono.
- Este runbook está errado ou incompleto? Corrija no mesmo PR das ações.
