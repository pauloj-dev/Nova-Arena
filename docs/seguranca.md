# Segurança — revisão antes do beta (issue #113, plano R2.2, PRD RNF-06 a RNF-09 e §16.5)

Revisão do OWASP Top 10 (2021) item a item contra o código real, os headers de segurança, as regras do Vercel
Firewall, as varreduras do CI e o teste de acesso a dados de outro usuário (IDOR). Incidentes: [`docs/runbook.md`](runbook.md).

**Regra que atravessa tudo:** a checagem que vale é a da **API** (`packages/api`). O `proxy.ts` do Next só
redireciona; o front só esconde botões.

## Resumo

| Item | Situação | Ação pendente principal |
|---|---|---|
| A01 Controle de acesso | ✅ forte (RBAC no banco a cada requisição, IDOR testado) | manter o teste IDOR atualizado a cada recurso novo |
| A02 Falhas criptográficas | ✅ Argon2id, AES-256-GCM, tokens só como hash | HSTS com *preload* depois do domínio definitivo |
| A03 Injeção (SQL, XSS) | ✅ Prisma parametrizado; HTML sanitizado; CSP com nonce | sanitizar o HTML rico também na gravação (hoje só na exibição) |
| A04 Design inseguro | ✅ limites de tentativa, BotID, regras de negócio no servidor | — |
| A05 Configuração | ✅ variáveis validadas, headers, erro sem stack | proteção de deploy nos previews (dono) |
| A06 Componentes vulneráveis | ✅ `pnpm audit` no CI (alto/crítico quebra) | revisar o relatório a cada PR de dependência |
| A07 Identificação e autenticação | ✅ sessão curta + refresh rotativo com detecção de roubo; 2FA para Admin | — |
| A08 Integridade | ✅ jobs assinados, auditoria e histórico só de inserção | — |
| A09 Logs e monitoramento | ✅ logs JSON com `requestId`, Sentry, alertas | testar cada alerta (#116) |
| A10 SSRF | ✅ só hosts fixos; URL do Blob conferida pelo SDK | — |

## OWASP Top 10 (2021)

### A01 — Quebra de controle de acesso

**O que protege**
- Papéis globais lidos do banco a cada requisição (`currentRoles`, `packages/api/src/auth/rbac.ts`); o JWT carrega
  papéis só para a borda redirecionar.
- Acesso a campeonato: dono e staff (`requireTournamentAccess`), Admin passa — mesma matriz do PRD §6.
- Toda rota `/admin/*`, de qualquer módulo, passa por `adminArea` (`packages/api/src/auth/admin.ts`): Admin/Super
  Admin **com 2FA ativo e feito nesta sessão**; senão 403 `TWO_FACTOR_REQUIRED` (RNF-08).
- Recursos com dono filtram pelo `userId` da sessão na própria consulta (`where: { userId }`), não depois: sessões
  de aparelho (`account/index.ts`), notificações, inscrições, squads (capitão), denúncias (`/me/reports`), disputas
  (partes + organização), envios de resultado, 2FA (`/me/2fa`), IDs de jogo (`auth/visibility.ts`: só a pessoa, a
  organização dos campeonatos dela, os adversários da partida e Admin).
- Arquivos privados (provas, denúncias) servidos só pela API em `/files/:id` depois de `canReadUpload`
  (`packages/api/src/uploads/access.ts`), com `Cache-Control: private, no-store`.
- Canais de tempo real: o token do Ably só dá `subscribe`, e `match:{id}`/`user:{id}` só para quem pode
  (`modules/realtime/index.ts`).
- Concluir upload confere que o arquivo foi enviado pela própria pessoa (prefixo do caminho com o `userId`).

**Evidência automatizada:** `packages/api/test/idor.integration.test.ts` (ver [Teste IDOR](#teste-de-acesso-a-dados-de-outro-usuário-idor)) e a matriz RBAC
(`rbac*.test.ts`).

**Risco residual:** recurso novo sem a checagem. **Ação:** todo módulo novo entra no teste IDOR (regra do
`packages/api/README.md`, passo 4: cada rota × visitante, participante, organizador e admin).

### A02 — Falhas criptográficas

**O que protege**
- Senhas com Argon2id (m=19 MiB, t=2, p=1 — parâmetros da OWASP), `packages/api/src/auth/crypto.ts`; comparação em
  tempo constante mesmo quando a conta não existe.
- Tokens de e-mail, refresh e convites: 256 bits aleatórios; no banco só o SHA-256.
- Segredo TOTP cifrado com AES-256-GCM e o `userId` como dado autenticado; códigos de recuperação como HMAC
  (`auth/two-factor.ts`). Código de sala também cifrado (`competition/lobby-crypto.ts`, `LOBBY_ENCRYPTION_KEY`).
- JWT HS256 com emissor, público e algoritmo fixos (`auth/jwt.ts`, `auth/edge.ts`); 15 min de validade.
- Cookies `httpOnly`, `SameSite=Lax` e `Secure` em HTTPS (`auth/cookies.ts`); refresh só vai para `/api/v1/auth`.
- HTTPS em todo lugar (Vercel) e HSTS no `proxy.ts` (abaixo).

**Risco residual:** `preload` do HSTS só faz sentido no domínio definitivo. **Ação (dono):** depois do domínio
`novaarena.gg` estável, inscrever em <https://hstspreload.org>.

### A03 — Injeção

**O que protege**
- SQL: Prisma com consultas parametrizadas; os `$queryRaw` usam *tagged templates* (parametrizados) e não há `$queryRawUnsafe`/`$executeRawUnsafe` no código da API.
- Entrada validada por Zod em toda rota (`body(c, Schema)`, `context.ts`); campos fora do schema são descartados
  (sem *mass assignment*). Saída validada pelo contrato (`respond`).
- XSS: React escapa por padrão. HTML rico (descrição, regulamento, textos legais) passa por DOMPurify antes de ir
  para a tela (`features/tournaments/RichText.tsx`, `features/organizer/components/RichText.tsx`,
  `shared/lib/sanitize.ts`). Uploads só PNG/JPG/WebP (sem SVG), conferidos de novo na API.
- Embeds de vídeo só de YouTube (`youtube-nocookie.com`) e Twitch, montados a partir de ID validado por regex
  (`shared/lib/sanitize.ts`), nunca da URL colada.
- CSP com nonce por requisição (abaixo): mesmo que um HTML escape da sanitização, script injetado não roda.

**Risco residual:** a API guarda o HTML rico como veio; a proteção está na exibição. Um consumidor futuro (e-mail,
app) que esqueça o DOMPurify fica exposto. **Ação:** sanitizar também na gravação (mesma lista de tags) — issue de
melhoria, não bloqueia o beta porque o único consumidor sanitiza e a CSP segura scripts.

### A04 — Design inseguro

**O que protege**
- Limites de tentativa (Upstash, por IP ou por conta): login e cadastro 5/min, recuperação de senha, verificação de
  e-mail, confirmação de senha (5 a cada 5 min por conta), 2FA (5 a cada 5 min por conta), código de convite de
  squad, eventos de produto (`packages/api/src/security.ts`, `RULES`). Mais a camada de fora no Firewall.
- BotID (Vercel) no cadastro e na recuperação de senha (`auth/bot.ts`).
- Senha fraca ou vazada recusada (lista + Have I Been Pwned por k-anonimato, `auth/password-policy.ts`).
- Pontuação nunca vem do cliente: o motor calcula a partir das estatísticas brutas (RN-01).
- Vagas sob concorrência (CT-02) e resultados com `Idempotency-Key`.
- Alertas antifraude (contas por IP/aparelho, ID de jogo repetido, ações administrativas em massa) — issue #114.

**Risco residual:** falha aberta do HIBP (se o serviço não responder em 2 s, a senha passa) — escolha consciente
para não travar o cadastro.

### A05 — Configuração de segurança incorreta

**O que protege**
- Variáveis validadas com Zod; em produção as do núcleo são obrigatórias (`env.ts`). Erro de configuração vira
  500 `CONFIG_INVALID` sem expor valores.
- Erros no formato `application/problem+json` sem stack trace nem mensagem interna (`errors.ts`, `app.ts`
  `onError`); o detalhe fica só no log, com `requestId`.
- Headers de segurança e CSP (abaixo); `X-Powered-By` desligado (`poweredByHeader: false` no `next.config.ts`).
- Rotas de Cron exigem `Authorization: Bearer $CRON_SECRET`; jobs exigem assinatura do QStash (`jobs/index.ts`).
- API simulada (MSW) desligada em produção (`NEXT_PUBLIC_API_MOCK=none`).

**Ações (dono, checklist §10 do plano):** variáveis como *Sensitive* na Vercel; **Deployment Protection** nos
previews; membros com o papel mínimo; tokens da Vercel com escopo e validade.

### A06 — Componentes vulneráveis e desatualizados

**O que protege:** lockfile congelado no CI (`--frozen-lockfile`); `pnpm audit --audit-level=high` no CI (job
"Segurança") quebra o build com vulnerabilidade alta ou crítica em qualquer dependência; política de cadeia de
suprimentos do pnpm (o lockfile passa pela verificação de *supply chain* do pnpm 11).

**Resultado da varredura na #113 (21/11/2026):**

| Pacote (indireto) | Gravidade | Caminho | Tratamento |
|---|---|---|---|
| `zod` < 4.6.6 | alta | `@vercel/blob` → `@vercel/oidc` → `@vercel/cli-config` | `overrides` no `pnpm-workspace.yaml` (`^4.6.6`) |
| `effect` ≤ 3.22.0 | alta | `prisma` → `@prisma/config` (CLI) | `overrides` (`^3.22.1`) |
| `minimatch` 7–11, `glob` 9–14 | moderada | ESLint e ferramentas de build | aceitas: só desenvolvimento, a correção é versão maior; rever quando o ESLint atualizar |

Depois dos `overrides`: **nenhuma vulnerabilidade alta ou crítica** (`pnpm audit --audit-level=high` limpo). Tire
cada `override` quando o pacote de cima atualizar.

### A07 — Falhas de identificação e autenticação

**O que protege**
- Sessão: JWT de acesso de 15 min + refresh rotativo; reuso de refresh já trocado revoga a família inteira
  (detecção de roubo, `auth/session.ts`). `sessionVersion` derruba os tokens em circulação em sanção ou troca de
  senha (efeito imediato).
- Aparelhos conectados com "sair deste aparelho" e "sair de todos" (`modules/account`).
- 2FA TOTP com proteção contra repetição do código e códigos de recuperação de uso único; obrigatório para Admin.
- OAuth com `state` e PKCE (`auth/oauth.ts`, `arctic`).
- Mensagem igual para e-mail inexistente e senha errada; recuperação de senha não revela se o e-mail existe.

### A08 — Falhas de integridade de software e dados

**O que protege**
- Jobs do QStash conferem a assinatura (chave atual ou a próxima); Cron confere o segredo.
- `audit_logs` e `result_events` só aceitam inserção: gatilhos bloqueiam `UPDATE`, `DELETE` e `TRUNCATE`
  (migrations `auditoria_imutavel` e de resultados). A exclusão de conta (LGPD) **não** mexe nelas
  (`docs/modelo-de-dados.md`).
- Build reprodutível: lockfile, `--frozen-lockfile`, dependências novas revisadas no PR.
- Scripts de terceiros: nenhum no navegador além dos da própria Vercel (BotID, Speed Insights, Analytics) e do
  Sentry, todos servidos do bundle ou do próprio domínio.

### A09 — Falhas de log e monitoramento

**O que protege:** uma linha JSON por evento com `requestId` (`logger.ts`), `X-Request-Id` na resposta, nunca
senha/token/cookie/código de sala/corpo; auditoria de toda ação administrativa com motivo; Sentry no front,
nas funções e nos jobs; alertas (erro > 1%, latência, QStash, Cron) em [`docs/operacao.md`](operacao.md).

**Ação:** cada alerta disparado em teste e chegando ao canal do time (critério da #116).

### A10 — Server-Side Request Forgery

**O que protege:** a API só faz requisições a hosts fixos no código (Have I Been Pwned, Discord, Google via
`arctic`, Ably REST, API da Vercel para o Edge Config, Resend, QStash, Upstash). A única URL vinda do cliente é a do
Blob no fim do upload, e ela vai para o SDK do Vercel Blob (`head(url, { token })`), que só consulta o próprio Blob;
depois a API confere dono (prefixo do caminho), tipo e tamanho. Embeds de vídeo são montados a partir de IDs.

**Risco residual:** nenhum conhecido. **Regra:** `fetch` com URL vinda do usuário exige revisão de segurança.

## Headers de segurança

- **CSP:** gerada no `apps/web/proxy.ts` para toda página, com um **nonce novo por requisição** (repassado ao Next
  pelo cabeçalho da requisição, que o põe nos próprios scripts; o layout raiz o põe no script do tema). Montagem em
  `apps/web/shared/security/headers.ts` (testada em `headers.test.ts`).
- **Demais headers:** em toda resposta (páginas, API e arquivos) pelo `headers()` do `next.config.ts`.
- O `smoke` pós-deploy confere todos (`ops/smoke/smoke.mjs`).

**Preço do nonce:** o HTML de cada página é gerado na hora (o layout lê o `x-nonce`), então não há página inteira em
cache na CDN nem ISR de página. Os dados públicos continuam em cache: `unstable_cache` no servidor do Next e
`Cache-Control: s-maxage` + `stale-while-revalidate` nas respostas da API (#111). Se o custo de função pesar no beta,
a alternativa é CSP sem nonce (com `'unsafe-inline'` em `script-src`) só nas páginas públicas — decisão a registrar
em ADR.

| Header | Valor | Por quê |
|---|---|---|
| `Content-Security-Policy` | ver abaixo | bloqueia script injetado (XSS), *clickjacking* e envio de formulário para fora |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` (só em HTTPS) | nunca mais HTTP no domínio |
| `X-Content-Type-Options` | `nosniff` | o navegador não "adivinha" tipo de arquivo |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | links externos não recebem o caminho (que pode ter IDs) |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), serial=(), hid=(), magnetometer=(), gyroscope=(), accelerometer=(), browsing-topics=()` | o site não usa; um script injetado também não |
| `X-Frame-Options` | `DENY` | navegadores antigos (o `frame-ancestors` cobre os novos) |
| `Cross-Origin-Opener-Policy` | `same-origin` | outra aba aberta pelo site não controla esta |

### Content-Security-Policy

```
default-src 'self';
script-src 'self' 'nonce-<aleatório>' 'strict-dynamic' 'wasm-unsafe-eval';  (+ 'unsafe-eval' só em desenvolvimento)
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://*.public.blob.vercel-storage.com https://lh3.googleusercontent.com
        https://cdn.discordapp.com https://i.ytimg.com https://static-cdn.jtvnw.net;
font-src 'self' data:;
connect-src 'self' https://*.ably.io wss://*.ably.io https://*.ably.net wss://*.ably.net
            https://*.ably-realtime.com wss://*.ably-realtime.com
            https://vercel.com https://*.blob.vercel-storage.com
            https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://vitals.vercel-insights.com;
                                                                    (+ ws: e http://localhost:* só em desenvolvimento)
media-src 'self' blob: data:;
frame-src https://www.youtube-nocookie.com https://www.youtube.com https://player.twitch.tv;
worker-src 'self' blob:;
manifest-src 'self';
frame-ancestors 'none';
form-action 'self';
base-uri 'self';
object-src 'none';
upgrade-insecure-requests;                                          (só em produção)
```

De onde vem cada domínio (conferido no código):

| Diretiva | Domínio | Origem no código |
|---|---|---|
| `img-src` | `*.public.blob.vercel-storage.com` | avatares, logos, banners e capas no Vercel Blob (`uploads/store.ts`) |
| `img-src` | `lh3.googleusercontent.com`, `cdn.discordapp.com` | foto do perfil trazida do login com Google/Discord (`auth/oauth.ts` grava a URL do provedor em `avatarUrl`) |
| `img-src` | `i.ytimg.com`, `static-cdn.jtvnw.net` | miniaturas de YouTube e Twitch (hoje o código só usa o player em iframe; mantidas para a prévia do vídeo — pode sair se nenhuma tela usar) |
| `connect-src` | `*.ably.net`, `*.ably-realtime.com`, `*.ably.io` | `ably` 2.x: `main.realtime.ably.net` e *fallbacks* `main.[a-e].fallback.ably-realtime.com`; `*.ably.io` para versões e rotas antigas (`rest.ably.io`) |
| `connect-src` | `vercel.com`, `*.blob.vercel-storage.com` | envio direto do navegador para o Vercel Blob (`@vercel/blob/client` usa `https://vercel.com/api/blob`) |
| `connect-src` | `*.ingest.sentry.io`, `*.ingest.us.sentry.io` | erros do Sentry no navegador. Com DSN, o build liga o túnel `/monitoring` (mesmo domínio) e estes ficam só de reserva |
| `script-src` | `'wasm-unsafe-eval'` | o desafio do Vercel BotID pode usar WebAssembly (não libera `eval` de JavaScript) |
| `connect-src` | `vitals.vercel-insights.com` | Speed Insights (a Vercel também serve por `/_vercel/speed-insights` no próprio domínio) |
| `frame-src` | `youtube-nocookie.com`, `youtube.com`, `player.twitch.tv` | transmissão embutida na página do campeonato (`shared/lib/sanitize.ts` gera `youtube-nocookie.com/embed/…` e `player.twitch.tv/?channel=…`) |

Observações:
- O script inline do tema (`apps/web/app/layout.tsx`, `themeInitScript`) recebe o **nonce** da requisição. O JSON-LD
  (`type="application/ld+json"`) não é executado e não precisa.
- Conferido no build de produção (`next start`): as páginas públicas, o login, o cadastro e Minha conta hidratam com a
  CSP ativa, sem violação no console (só o `/_vercel/speed-insights/script.js`, que não existe fora da Vercel).
- O MSW (protótipo, `NEXT_PUBLIC_API_MOCK≠none`) registra um *service worker* do próprio domínio: coberto por `'self'`.
- `style-src 'unsafe-inline'` fica porque o Next, o Radix e o editor rico injetam estilos; o risco de CSS injetado é
  baixo com scripts travados pelo nonce.
- Mudou um domínio externo? Atualize `CSP_SOURCES` em `apps/web/shared/security/headers.ts`, esta tabela e rode o smoke.

## Vercel Firewall

Configuração versionada em `ops/firewall/regras.json` (formato da API do Firewall), aplicada por
`ops/firewall/aplicar.mjs` (simulação por padrão; `--aplicar` grava; precisa de `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`
e `VERCEL_TEAM_ID`). O Firewall é a **camada de fora**, por IP e com limites folgados; o limite que vale por conta
continua na API (Upstash). Tráfego barrado pelo Firewall não é cobrado.

| Regra | Rota | Limite por IP | Ação |
|---|---|---|---|
| Bloquear sondagens de exploit | `/wp-admin`, `/.env`, `/.git/`… | — | negar por 1 h |
| Limite: login | `POST /api/v1/auth/login` | 20/min | 429 |
| Limite: cadastro e recuperação de senha | `POST /api/v1/auth/{register,forgot-password,reset-password,resend-verification,verify-email,confirm-email-change}` | 30/10 min | desafio |
| Limite: verificação em duas etapas | `POST /api/v1/auth/2fa/*`, `POST /api/v1/me/2fa/*` | 20/5 min | negar por 15 min |
| Limite: senha e e-mail da conta | `POST /api/v1/me/password*`, `POST /api/v1/me/email` | 20/10 min | 429 |
| Limite: uploads | `POST /api/v1/uploads/*` | 30/min | 429 |
| Limite: LGPD | `/api/v1/me/export*`, `DELETE /api/v1/me` | 10/h | 429 |
| Limite: denúncias | `POST /api/v1/reports` | 20/10 min | 429 |
| Limite: token do tempo real | `POST /api/v1/realtime/token` | 60/min | 429 |
| Desafio: página de cadastro | `GET /cadastro` | — | desafio (bots verificados passam) |
| Rede de segurança: API inteira | `/api/v1/*` (menos `/jobs` e `/cron`) | 600/min | só registra (log) |
| Liberar gerador de carga (k6) | IP + cabeçalho secreto + host do staging | — | *bypass*, **desligada** (só durante a #112) |

**Rollout em estágios (sempre):** 1) `aplicar.mjs --aplicar --modo-log` (tudo só registra); 2) olhar o tráfego de
cada regra em Vercel → Firewall → Traffic por alguns dias (ninguém legítimo batendo?); 3) aplicar sem `--modo-log`
no staging/preview e testar; 4) produção, acompanhando as primeiras 24 h. Contadores são por região: com uma região
(`gru1`) o limite é o configurado.

**Proteção contra bots:** BotID nas mutações sensíveis (cadastro, recuperação de senha) + regra de desafio na página
de cadastro + regra gerenciada **Bot Protection** ligada no painel (Firewall → Bot Management, modo *log* primeiro).

**Attack Challenge Mode (pronto para ataques):** Vercel → Firewall → **Attack Challenge Mode** → ligar (1 h, 6 h ou
24 h). Todo visitante não verificado passa por um desafio; buscadores verificados e os Crons da Vercel continuam.
Quando ligar: pico de tráfego anormal, 429/CPU disparando, Neon saturado por requisições de poucos IPs/ASNs. Quem
liga: o responsável pelo incidente (runbook). Desligue assim que o ataque passar e registre a janela. Não é
automatizado por script de propósito (ação de impacto, decidida por gente).

**Pendências do dono:** aplicar as regras (estágios acima), ligar Bot Protection e AI Bots (modo log → desafio),
configurar o alerta de "regra disparando muito" no painel.

## Varreduras no CI

| Varredura | Onde | Quebra o build quando |
|---|---|---|
| Dependências: `pnpm audit --audit-level=high` | job "Segurança" do `.github/workflows/ci.yml` | vulnerabilidade **alta ou crítica** em qualquer dependência |
| Segredos: gitleaks 8.28 (regras padrão + `.gitleaks.toml`) | job "Segurança" do `.github/workflows/ci.yml` | qualquer segredo nos arquivos do commit |
| GitHub Secret Scanning + Push Protection | configuração do repositório (dono) | bloqueia o push com segredo conhecido |

O gitleaks do CI varre os arquivos do commit (`gitleaks dir`). O **histórico** precisa de uma varredura única, à mão,
antes do beta, num clone completo:
`docker run --rm -v "$PWD:/repo" ghcr.io/gitleaks/gitleaks:v8.28.0 git /repo --config /repo/.gitleaks.toml --redact`.
Na #113 a varredura dos arquivos atuais deu **zero achados** (as senhas e tokens de mentira dos testes estão na
exceção do `.gitleaks.toml`).

Falso positivo do gitleaks: acrescente a regra de exceção no `.gitleaks.toml` com o motivo, nunca desligue a
varredura. Segredo real encontrado: [runbook → Vazamento de segredo](runbook.md#vazamento-de-segredo) (rotacionar
primeiro).

## Teste de acesso a dados de outro usuário (IDOR)

`packages/api/test/idor.integration.test.ts` (Postgres real, 40 casos): a "intrusa" (conta comum sem relação), a
"rival" (adversária, para o que ela pode ver de direito) e um segundo organizador tentam ler, alterar e apagar os
recursos da "dona" e do campeonato do "org" pelos IDs. Cobertos: inscrição (cancelar, confirmar, recusar, desistir,
analisar), squad (renomear, apagar, convidar, capitania, membros) e convites, notificações, envios de resultado
(ver, confirmar, contestar, revisar), disputas (ver, escrever, resolver, escalar), sala da partida, lançamento de
resultado, arquivos privados (prova e anexo de denúncia, inclusive pela pessoa denunciada), aparelhos, 2FA (reset só
pelo Admin), IDs de jogo (perfil privado), exportação LGPD e a área do organizador (painel, edição, CSV de inscritos,
auditoria, cancelamento). Cada tentativa precisa responder 401/403/404/409 (nunca 2xx nem 500); um caso confere que
**nada mudou no banco**, outro que as listas pessoais e o perfil público não vazam nada, e um controle positivo
garante que quem tem direito continua vendo.

Recurso novo com dono? Acrescente ao teste no mesmo PR.

## Antifraude (issue #114)

Sinais automáticos, sem bloquear ninguém (um alerta não é prova): várias contas entrando do mesmo IP (5 em 24 h —
limite alto por causa do CGNAT das operadoras) ou do mesmo aparelho (cookie `na_dev`, aleatório e sem dado pessoal,
3 em 30 dias), o mesmo ID de jogo em contas diferentes e **ações administrativas em massa** (10 banimentos, 15
sanções, 10 mudanças de papel ou 5 cancelamentos em 1 min pelo mesmo Admin — risco R4 do PRD), que também avisam o
Super Admin. A fila fica em Moderação → Alertas; o alerta sobre um Admin só aparece para o Super Admin e quem o
disparou não pode fechá-lo. Código: `packages/api/src/fraud.ts`; limites em `FRAUD_THRESHOLDS` (`@nova/schemas`).

## Checklist do PR de segurança

- [ ] Rota nova valida a entrada com Zod e a saída com `respond`.
- [ ] Rota nova com recurso de alguém filtra por dono na consulta e entra no teste IDOR.
- [ ] Nada de segredo, token, cookie ou corpo de requisição no log.
- [ ] `fetch` com URL vinda de usuário? Revisão de segurança.
- [ ] HTML vindo de usuário só com DOMPurify; nada de `dangerouslySetInnerHTML` sem sanitizar.
- [ ] Domínio externo novo no navegador? CSP no `proxy.ts` + tabela acima.
- [ ] Migration compatível com a versão anterior (rollback, `docs/banco.md`).
