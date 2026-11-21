/**
 * Script inline do `<head>` (com o nonce da CSP), sem `'use client'` para o layout do servidor importar o texto.
 * Antes da primeira pintura, marca `<html data-consent>` quando a escolha de cookies já existe: o aviso, que vem no
 * HTML, fica escondido pelo CSS (`CookieBanner`). Os E2E das outras telas também o escondem (`__NOVA_E2E__`); o E2E do
 * próprio aviso liga `__NOVA_SHOW_CONSENT__`. A chave é a mesma de `consent.ts` (`CONSENT_KEY`).
 */
export const consentInitScript =
  "try{var w=window,c=localStorage.getItem('nova-consent');if((c&&JSON.parse(c).version===1)||(w.__NOVA_E2E__&&!w.__NOVA_SHOW_CONSENT__))document.documentElement.dataset.consent='1'}catch(e){}";
