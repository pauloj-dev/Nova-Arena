/**
 * Proteção contra bots (issue #69): o Vercel BotID assina as requisições do cadastro e da recuperação de
 * senha, e a API confere (`packages/api/src/auth/bot.ts`). Em desenvolvimento o BotID não faz nada.
 */
import { initBotId } from 'botid/client/core';

initBotId({
  protect: [
    { path: '/api/v1/auth/register', method: 'POST' },
    { path: '/api/v1/auth/forgot-password', method: 'POST' },
  ],
});
