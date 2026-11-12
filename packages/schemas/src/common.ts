import { z } from 'zod';

export const Id = z.string().min(1);
/** Data e hora em ISO 8601, sempre em UTC. */
export const IsoDateTime = z.iso.datetime({ offset: true });
export const Slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use só letras minúsculas, números e hífens');

/** Erro no padrão RFC 7807 (`application/problem+json`). */
export const Problem = z.object({
  type: z.string().default('about:blank'),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  /** Código estável para a tela decidir o que mostrar (ex.: `NICKNAME_TAKEN`). */
  code: z.string().optional(),
  /** Erros por campo, quando a validação falha. */
  errors: z.record(z.string(), z.string()).optional(),
});
export type Problem = z.infer<typeof Problem>;

/** Página com cursor: `nextCursor` nulo significa fim da lista. */
export function page<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable(), total: z.number().int().optional() });
}
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  total?: number;
}

/** Página numerada (tabelas do Admin). */
export function numberedPage<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), page: z.number().int(), pageCount: z.number().int(), total: z.number().int() });
}
export interface NumberedPage<T> {
  items: T[];
  page: number;
  pageCount: number;
  total: number;
}

export const Ok = z.object({ ok: z.literal(true) });
