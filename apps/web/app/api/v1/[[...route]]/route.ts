/**
 * API real (Hono, `packages/api`) montada no Next.js como Vercel Function (Node.js, região `gru1`).
 * No navegador, os módulos ainda simulados (`NEXT_PUBLIC_API_MOCK`) são atendidos pelo MSW antes de
 * chegar aqui; o que não é simulado cai nesta rota.
 */
import { createRouteHandler } from '@nova/api';

const handler = createRouteHandler();

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
