# Jobs e Cron (ADR-008, issue #99)

Tudo o que tem hora marcada roda em duas peças, sem servidor contínuo:

| Peça | Quem chama | Proteção | O que faz |
|---|---|---|---|
| `GET /api/v1/cron/sweep` | Vercel Cron, a cada minuto | `Authorization: Bearer $CRON_SECRET` | Abre e fecha inscrições na data; devolve à fila o squad que não completou o elenco no prazo (RN-12); aplica o W.O. atrasado de quem não fez check-in (RN-04). |
| `GET /api/v1/cron/daily-cleanup` | Vercel Cron, 06:00 UTC (03:00 em Brasília) | `CRON_SECRET` | Convites de squad vencidos, uploads órfãos (24 h sem recurso), tokens de e-mail e sessões velhos. |
| `POST /api/v1/jobs/*` | QStash, na data agendada | assinatura do QStash (chave atual ou a próxima) | Ex.: abrir/fechar as inscrições de um campeonato logo após publicar. |
| `POST /api/v1/jobs/matches/check-in` | QStash, no fechamento da janela de check-in | assinatura do QStash | W.O. automático: só um lado fez check-in → o outro leva W.O. e o vencedor avança. Mensagem de horário antigo (partida reagendada) é ignorada. |
| `POST /api/v1/jobs/failures` | QStash, quando uma mensagem esgota as tentativas | assinatura do QStash | Registra a falha definitiva em `job_failures`. |

Sem segredo ou assinatura: **401**. Os crons estão em `apps/web/vercel.json` — Cron por minuto exige o **plano Pro** da Vercel (checklist da #64).

## Check-in e W.O. (issue #84)

- Agendar ou reagendar uma partida cria a mensagem `checkin-<partida>-<horário>` para o fechamento da janela. Reagendar zera os check-ins; a mensagem antiga chega com o horário velho e não faz nada.
- O W.O. roda numa transação com a fase travada (`SELECT … FOR UPDATE`) e só age se a partida ainda não tem resultado: entregue duas vezes (ou junto com o Cron), aplica uma vez. Fica na auditoria como `WALKOVER_APPLIED`, sem autor (sistema).
- Os dois presentes: joga-se. Os dois ausentes: a organização decide (`POST /matches/:id/walkover`, com motivo).
- **Pendente da #98 (notificações):** os avisos de lembrete 15 min antes, check-in aberto, sala liberada e W.O. aplicado. A sala já só é mostrada a partir da abertura do check-in (`GET /matches/:id/lobby`).

## Regras para escrever um job

1. **Confira o estado atual antes de agir** e faça a mudança numa atualização condicional (`updateMany` com o status esperado) ou dentro da transação com a trava do campeonato. Rodar duas vezes não pode duplicar efeito.
2. Rode dentro de `runJob(c, nome, origem, fn)`: erro inesperado vira 500 (o QStash tenta de novo) e, no Cron, fica registrado em `job_failures`.
3. Ao agendar no QStash, use um `dedupId` estável (`acao-id-data`): reagendar a mesma coisa não cria mensagem nova.

## Falhas na Saúde do Sistema

`GET /api/v1/admin/system/job-failures` (Admin) lista as falhas abertas; `POST /api/v1/admin/system/job-failures/:id/resolve` marca como resolvida. A tela entra com a #94.

## Testar localmente com o QStash

```bash
npx @upstash/qstash-cli dev
```

O comando mostra a URL e as chaves locais. No `.env.local` do `apps/web`, use `QSTASH_URL` (a URL local), `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY` e `QSTASH_NEXT_SIGNING_KEY` que ele imprimir, e `NEXT_PUBLIC_SITE_URL=http://localhost:3000`. Publique um campeonato com data de abertura daqui a um minuto e acompanhe a mensagem chegar em `/api/v1/jobs/tournaments/registration`.

Para o Cron, chame a rota com o segredo:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/v1/cron/sweep
```
