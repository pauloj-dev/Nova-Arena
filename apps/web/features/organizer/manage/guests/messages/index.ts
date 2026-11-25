import { defineMessages } from '@/shared/i18n/core';
import ptBR from './pt-BR.json';

/**
 * Textos de quem a organização cadastra: importação por planilha, inscrito avulso e elenco sem conta (RN-18).
 * Catálogo próprio porque essas telas são carregadas sob demanda (com a aba Inscrições ou ao abrir): os textos
 * delas ficam fora do JavaScript inicial da gestão do campeonato.
 */
export const messages = defineMessages({ 'pt-BR': ptBR });
