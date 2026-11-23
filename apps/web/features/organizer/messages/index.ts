import { defineMessages } from '@/shared/i18n/core';
import ptBR from './pt-BR.json';

/**
 * Textos da área do organizador que não têm catálogo próprio: painel, meus campeonatos, modelos, primeiros passos,
 * os componentes de `components/` e as funções de `lib/`. A gestão, a operação, o assistente e o montador de fases
 * têm cada um o seu (`manage/messages`, `operation/messages`, `wizard/messages`, `stage-builder/messages`).
 */
export const messages = defineMessages({ 'pt-BR': ptBR });
