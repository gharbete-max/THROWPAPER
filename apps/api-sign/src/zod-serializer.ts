import type { FastifySerializerCompiler } from 'fastify';
import { ResponseSerializationError } from 'fastify-type-provider-zod';
import type { $ZodType } from 'zod/v4/core';

/**
 * The response serializer: `parse`, then `JSON.stringify` — what `fastify-type-provider-zod` 4 did.
 *
 * Version 7's own `serializerCompiler` runs `safeEncode`, which refuses any schema holding a
 * `.transform()` ("unidirectional transform during encode"). Response schemas here rely on parsing
 * to strip unknown keys, apply defaults and normalise, so the wire output must come from `parse`.
 */
export const serializerCompiler: FastifySerializerCompiler<$ZodType | { properties: $ZodType }> =
  ({ schema, method, url }) =>
  (data) => {
    const zod = 'properties' in schema ? schema.properties : schema;
    const result = (
      zod as unknown as { safeParse(d: unknown): { error?: unknown; data?: unknown } }
    ).safeParse(data);
    if (result.error)
      throw new ResponseSerializationError(method, url, { cause: result.error as never });
    return JSON.stringify(result.data);
  };
