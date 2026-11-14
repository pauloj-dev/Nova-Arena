# E-mails transacionais (issue #80)

Templates em **React Email** (`packages/email`) com a identidade Nova Green, enviados pelo **Resend** (integração do Marketplace da Vercel). A API usa uma camada única (`createMailer` de `@nova/email`); nenhum outro lugar fala com o Resend.

## Templates

| Template | Quando sai | Link |
|---|---|---|
| `VERIFY_EMAIL` | Cadastro e "reenviar verificação" | `/verificar-email?token=…` (24 h, uso único) |
| `RESET_PASSWORD` | "Esqueci a senha" | `/redefinir-senha?token=…` (1 h, uso único) |
| `ROLE_INVITE` | Convite de Admin/Organizador (issue #92) | `/convite/<token>` |
| `TEAM_INVITE` | Convite de squad por apelido (issue #78) | página do convite |

Os textos ficam em `packages/email/src/messages.pt-BR.ts` (preparado para i18n, issue #108). As cores vêm do tema claro de `packages/ui/src/styles/tokens.css`; o teste de cores em `packages/email/test/email.test.ts` quebra se divergirem. Todo e-mail sai com versão em texto puro (ajuda a não cair no spam).

## Onde cada e-mail vai

| Ambiente | Comportamento | Variáveis |
|---|---|---|
| Produção (`VERCEL_ENV=production`) | Envia de verdade. Sem as variáveis, a API não sobe. | `RESEND_API_KEY`, `EMAIL_FROM` |
| Preview e staging | Tudo vai para a **caixa de teste**; o destinatário original aparece no assunto (`[teste para fulano@…]`). | `RESEND_API_KEY`, `EMAIL_TEST_INBOX` (e `EMAIL_FROM`, se houver) |
| Local ou preview sem Resend | Só registra no log que o e-mail seria enviado, **sem o link** (ele dá acesso à conta). | — |

Fora de produção, a API também devolve `devVerifyToken`/`devResetToken` na resposta, para as telas mostrarem o link durante os testes. Em produção esses campos nunca vão. Eles saem de vez antes do lançamento (plano R2).

## Checklist do dono do projeto (domínio)

Feito no painel do Resend e no DNS do domínio definitivo (ADR-0001 Q7: `novaarena.gg`, provisório). Ninguém do time de desenvolvimento cria conta nem mexe no DNS.

- [ ] **Domínio no Resend:** adicionar `novaarena.gg` (ou um subdomínio de envio, ex.: `mail.novaarena.gg`) e escolher a região mais próxima.
- [ ] **SPF:** registro TXT que o Resend indicar (inclui o servidor de envio dele).
- [ ] **DKIM:** os registros CNAME/TXT de DKIM que o Resend gerar.
- [ ] **DMARC:** TXT em `_dmarc.novaarena.gg`. Comece com `v=DMARC1; p=none; rua=mailto:dmarc@novaarena.gg` para observar; depois de alguns dias sem falhas, suba para `p=quarantine`.
- [ ] Domínio aparece como **Verified** no Resend.
- [ ] `EMAIL_FROM` em Production, ex.: `Nova Arena <nao-responda@novaarena.gg>`.
- [ ] Uma caixa de teste da equipe em `EMAIL_TEST_INBOX` (Preview e Staging).

## Como conferir o critério de aceite ("não cai em spam")

1. Em staging, cadastre contas de teste no Gmail, Outlook e iCloud.
2. Confira se o e-mail de verificação chega na caixa de entrada (não no spam).
3. No Gmail, "Mostrar original" deve indicar `SPF: PASS`, `DKIM: PASS` e `DMARC: PASS`.
4. Opcional: mande um e-mail para um verificador de entregabilidade (ex.: mail-tester) e mire nota 9/10 ou mais.
