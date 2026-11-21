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
