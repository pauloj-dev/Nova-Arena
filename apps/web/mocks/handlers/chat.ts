/**
 * Módulo `chat` da API simulada: chat por partida (issue 125).
 */
import type { HttpHandler } from 'msw';

export const moduleName = 'chat';

export const handlers: HttpHandler[] = [];
