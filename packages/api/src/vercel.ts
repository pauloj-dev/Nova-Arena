/** Adaptador da API para a rota do Next.js (`app/api/v1/[[...route]]/route.ts`), que roda como Vercel Function. */
import { handle } from 'hono/vercel';
import { createApp, type CreateAppOptions } from './app';

/** Um handler para todos os métodos HTTP da rota. */
export function createRouteHandler(options?: CreateAppOptions): (request: Request) => Response | Promise<Response> {
  return handle(createApp(options));
}
