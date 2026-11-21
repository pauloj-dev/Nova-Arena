/**
 * Módulo `discord` da API simulada: vínculo do bot do Discord (issue 121).
 */
import type { HttpHandler } from 'msw';

export const moduleName = 'discord';

export const handlers: HttpHandler[] = [];
