import type { Context } from 'hono';
import type { z } from 'zod';
import { badRequest } from '../core/errors.ts';

/** Parse and validate a JSON body; failures become a 400 listing every bad field. */
export async function parseBody<S extends z.ZodTypeAny>(c: Context, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest('Request body must be JSON');
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw badRequest(result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  return result.data;
}
