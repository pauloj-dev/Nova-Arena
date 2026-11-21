# Tempo real, notificações, push e 2FA (issues #97, #98, #109 e #95)

## Tempo real (Ably, #97)

- A API só **publica** (REST do Ably, depois do commit; `packages/api/src/realtime.ts`). Falha ao publicar vai para o log e não derruba a requisição.
- O navegador assina com o token de `POST /api/v1/realtime/token`, que traz só os canais permitidos: `tournament:*` (qualquer um), `user:{id}` (só o dono) e `match:{id}` (quem joga a partida e a organização do campeonato). A tela pede as partidas em `{ channels: ["match:<id>"] }`; as que a pessoa não pode ver são descartadas.
- `apps/web/shared/realtime/ably-client.ts` implementa `RealtimeClient`. O `RealtimeProvider` usa o Ably quando `realtime` **não** está em `NEXT_PUBLIC_API_MOCK`; enquanto houver módulos simulados (preview/staging), soma o barramento do protótipo.
- Sem `ABLY_API_KEY` (ou Ably bloqueado na rede): a rota responde 503 `REALTIME_UNAVAILABLE`, a tela mostra "Reconectando… atualizando a cada 10 s" e o polling assume (CT-10).
- `session.revoked` no canal `user:{id}` (ex.: redefinição de senha) faz a tela voltar para visitante na hora.

## Notificações (#98)

Todo módulo chama `notify(c, userIds, { type, title, body, link })` depois do commit. Para cada pessoa, conforme as preferências do tipo:

| Canal | O que acontece |
|---|---|
| No site | Registro em `notifications` + evento `notification.created` em `user:{id}` |
| E-mail | Job `POST /api/v1/jobs/notifications/email` no QStash (dedup `email-<id>`), template `NOTIFICATION` |
| Celular (push) | Job `POST /api/v1/jobs/notifications/push` (dedup `push-<id>`), só para quem assinou o push |

- Desligar "no site" e manter o e-mail grava o registro com `inApp = false` (fora da lista e do contador): o id dele evita e-mail duplicado.
- `SANCTION` (avisos da moderação) não desliga em nenhum canal.
- O e-mail sai só para conta ativa com e-mail confirmado, e a preferência é conferida de novo na hora do envio.
- Idempotência do e-mail: `emailSentAt` marcado + `Idempotency-Key: notification-<id>` no Resend. Falha do Resend → 500 → o QStash tenta de novo sem duplicar.

## Push no PWA (#109)

- Chaves VAPID em `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` (gere com `npx web-push generate-vapid-keys`). Sem elas, `GET /push/public-key` responde 503 e nada é enviado.
- Assinatura: `POST /api/v1/me/push-subscriptions` (`PushSubscription.toJSON()`); cancelamento: `DELETE /api/v1/me/push-subscriptions?endpoint=…`. Assinatura que o navegador cancelou (404/410) é apagada no envio.
- O convite aparece **depois da primeira inscrição**, com a flag `pushNotifications` ligada, e a permissão só é pedida no clique em "Ativar avisos" (`features/notifications/push/PushPrompt.tsx`).
- Service worker: `features/notifications/push/sw.ts` exporta `registerPushHandlers(self)` (eventos `push` e `notificationclick`). O SW do PWA (#105) só precisa importar e chamar.

### Limitações conhecidas

- **iPhone e iPad (iOS/iPadOS 16.4 ou mais novo):** o push só funciona com a Nova Arena **instalada na tela de início** (Compartilhar → Adicionar à Tela de Início). No Safari aberto como página, o navegador não oferece push e o convite não aparece.
- Permissão negada só volta pelas configurações do navegador para o site; o convite não insiste.
- Sem o service worker do PWA registrado, não há onde receber: o convite avisa que o aparelho não recebe avisos.
- A entrega depende do serviço de push do navegador (Google, Apple, Mozilla). O aviso vale por 24 h (TTL); o id da notificação é a `tag`, então uma repetição substitui a anterior.

## Verificação em duas etapas (#95)

- TOTP (RFC 6238, 6 dígitos, 30 s, ±1 passo). Segredo cifrado com AES-256-GCM (`TWO_FACTOR_ENCRYPTION_KEY`, 32 bytes em base64); códigos de recuperação (8, uso único) guardados só como HMAC. **Trocar a chave invalida o 2FA de todas as contas.**
- O mesmo código não entra duas vezes; 5 tentativas de código a cada 5 minutos por conta (429 `RATE_LIMITED`).
- Login de quem tem 2FA: `POST /auth/login` responde 202 `{ twoFactorRequired: true }` e um cookie `na_tfa` de 5 minutos; `POST /auth/2fa/verify { code }` abre a sessão com `tfa` no token. O login social também passa pelo código (`/entrar?etapa=codigo`).
- `/admin/*` exige 2FA ativo **e** feito na sessão (`requireAdminTwoFactor` em `packages/api/src/auth/two-factor.ts`); na borda, o Admin sem `tfa` vai para `/minha-conta/seguranca`.
- Redefinição pelo Super Admin: `POST /admin/users/:id/2fa/reset { reason }`, auditada, avisa a pessoa (`SANCTION`).
- `GET /me/2fa/dev-code` existe só na API simulada.

## Bot do Discord (issue 121)

Interações por **webhook HTTP** numa Vercel Function. Não há processo contínuo nem gateway WebSocket do Discord.

| Peça | O que faz |
|---|---|
| `POST /api/v1/discord/interactions` | Rota que o Discord chama. Confere a assinatura Ed25519 (`X-Signature-Ed25519` + `X-Signature-Timestamp`) com `DISCORD_PUBLIC_KEY` antes de tudo: 401 se for inválida. Fica fora da checagem de `Origin` (não vem de navegador). |
| `/nova-arena vincular codigo:` | Liga o canal onde foi digitado ao campeonato do código. Exige três coisas: a permissão "Gerenciar servidor" no Discord, a conta do Discord vinculada a uma conta Nova Arena e essa conta ser da organização que gerencia (dono, co-organizador ou Admin). O código tem uso único e vale 15 min. O banco guarda só o SHA-256 dele. |
| `/nova-arena checkin` | Check-in da próxima partida com a janela aberta. Usa as mesmas regras da tela: no squad, o capitão ou todos os titulares. |
| `/nova-arena proxima` | Mostra a próxima partida. O horário vai em `<t:…>`, que o Discord exibe no fuso de quem lê. |
| `GET/DELETE /tournaments/:id/discord`, `POST …/code`, `POST …/test` | Aba **Discord** da operação. Só a organização que gerencia usa essas rotas; o moderador não. |
| `POST /jobs/discord/announce` | Job do QStash que entrega o aviso no canal. |
| `POST /jobs/discord/reminder` | Job do QStash que avisa "partida em 15 minutos". Uma mensagem de horário antigo, de partida reagendada, não faz nada. |

- **Vínculo de conta:** quem chama um comando é identificado pela conta do Discord vinculada à conta Nova Arena, pelo login com Discord que já existe (`oauth_accounts`). Essa conta se vincula em Minha conta → Segurança.
- **Avisos automáticos:** saem pelos mesmos eventos de `notify`/`publish`:

  | Evento | Onde o aviso é disparado |
  |---|---|
  | Resultado lançado ou corrigido | `afterResult` |
  | W.O. | `afterWalkover` |
  | Chave confirmada | rota de confirmação da chave |
  | Campeão | encerramento do campeonato |
  | Partida em 15 min | lembrete agendado junto com as mensagens da partida, ao agendar ou reagendar |

  Ao vincular, os lembretes das partidas que já estão agendadas também entram na fila.
- **Entrega:** a mensagem vai com `allowed_mentions: { parse: [] }`, então o bot nunca menciona `@everyone`. Os nomes digitados por pessoas são escapados.
- **Quando a entrega falha:**

  | Resposta do Discord | O que acontece |
  |---|---|
  | 403 ou 404 (canal sem permissão ou apagado) | O motivo vai para `lastError`, que a aba mostra, e o job não tenta de novo. |
  | 429 ou 5xx | Resposta 500, e o QStash tenta de novo. |
- **Variáveis:** `DISCORD_APP_ID`, `DISCORD_PUBLIC_KEY` e `DISCORD_BOT_TOKEN` (`.env.example`). Sem as três, o bot fica desligado, a aba explica isso e o resto do site segue igual.
- **Configuração no Discord Developer Portal:**
  - **Interactions Endpoint URL:** `<SITE_URL>/api/v1/discord/interactions`.
  - **Registro dos comandos:** `node ops/discord/register-commands.mts`. Com `DISCORD_GUILD_ID`, os comandos aparecem na hora, num servidor de teste. Para ver o que seria enviado sem registrar nada, use `--dry-run`.
- **Protótipo:** o bot conta como configurado. "Simular o comando no protótipo" manda `/nova-arena vincular` para a API simulada como se a pessoa logada tivesse digitado o comando num servidor de demonstração. O protótipo não confere a assinatura.

## Chat por partida (issue 125)

| Rota | O que faz |
|---|---|
| `GET /matches/:id/chat` | as últimas 100 mensagens |
| `POST /matches/:id/chat` | envia uma mensagem |
| `DELETE /matches/:id/chat/:messageId` | a organização oculta qualquer mensagem; o autor, só a própria |

- **Quem usa:** quem joga a partida e a organização do campeonato (dono, co-organizador, moderador e Admin). É a mesma regra do canal `match:{id}`.
- **Moderação básica:**
  - até 500 caracteres;
  - 5 mensagens a cada 30 s por pessoa na partida (`RATE_LIMITED`);
  - só leitura fora do andamento do campeonato (`CHAT_CLOSED`);
  - denúncia pelo `ReportButton`, com o alvo `CHAT_MESSAGE`; a moderação vê o texto como ele estava.
- **Tempo real:** o evento `chat.updated` vai no canal `match:{id}`, pelo Ably na API real ou pelo barramento no protótipo. Ele não leva o texto: a tela busca as mensagens na API. Sem tempo real, a tela atualiza a cada 10 s.
- **Na tela:** o chat aparece no detalhe da partida (participante) e no botão "Chat" da operação (organização).
