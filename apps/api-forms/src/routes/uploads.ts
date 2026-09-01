import { z } from 'zod';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { api } from '@tp/shared';
import type { AuthGuardDeps } from '../auth/plugin.js';
import { requireAuth } from '../auth/plugin.js';
import type { Repositories } from '../db/repositories/index.js';
import { recordAudit } from '../audit.js';
import { checkImage, MAX_IMAGE_BYTES } from '../uploads/image.js';
import { assetPath, isAssetKey, type AssetStore } from '../uploads/store.js';

const UploadResponse = z.object({
  key: z.string(),
  /** Where to reference it from. Relative, so it works on any host the app is served from. */
  path: z.string(),
  contentType: z.string(),
  bytes: z.number().int().nonnegative(),
});

const KeyParam = z.object({ key: z.string().min(1).max(128) });

/** A year. Safe because the key is the hash of the content: these bytes can never change. */
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

export function registerUploadRoutes(
  app: FastifyInstance,
  deps: { repos: Repositories; guard: AuthGuardDeps; assets: AssetStore },
): void {
  const adminOnly = requireAuth(deps.guard, ['admin']);

  /**
   * Upload an image. Admins only — this writes bytes that are then served to the public, which is
   * not something an operator working the door needs to be able to do.
   */
  app.post('/v1/uploads', {
    preHandler: adminOnly,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['uploads'],
      response: {
        201: UploadResponse,
        400: api.ErrorResponse,
        401: api.ErrorResponse,
        403: api.ErrorResponse,
        413: api.ErrorResponse,
      },
    },
    handler: async (request, reply) => {
      const file = await request.file({ limits: { fileSize: MAX_IMAGE_BYTES } });
      if (!file) {
        return reply
          .code(400)
          .send({ error: { code: 'no-file', message: 'Send one file as multipart form data' } });
      }

      const content = await file.toBuffer();

      /**
       * The stream cap and this check are not redundant. The cap stops a very large upload from
       * being buffered at all; `truncated` tells us it *was* cut off, so a file that hit the limit
       * is refused rather than silently stored as a corrupt half-image.
       */
      if (file.file.truncated) {
        return reply.code(413).send({
          error: {
            code: 'too-large',
            message: `Images must be ${Math.floor(MAX_IMAGE_BYTES / 1024 / 1024)}MB or smaller`,
          },
        });
      }

      // The declared mimetype and the filename are the uploader's words. The bytes are evidence.
      const checked = checkImage(content);
      if (!checked.ok) {
        const status = checked.code === 'too-large' ? 413 : 400;
        return reply.code(status).send({ error: { code: checked.code, message: checked.message } });
      }

      const stored = await deps.assets.put(content, checked.format);

      await recordAudit(deps.repos, request, {
        action: 'upload.create',
        entityType: 'asset',
        entityId: stored.key,
        after: { bytes: stored.bytes, contentType: stored.contentType },
      });

      return reply.code(201).send({
        key: stored.key,
        path: assetPath(stored.key),
        contentType: stored.contentType,
        bytes: stored.bytes,
      });
    },
  });

  /**
   * Serve an uploaded image. **No authentication**, on purpose: a logo is painted on a public form
   * that anybody can open, so anything else would break the page for the people it is for.
   *
   * What protects this is that the key is the SHA-256 of the content. It cannot be guessed, it
   * cannot be enumerated, and it cannot encode a path.
   */
  app.get('/public/assets/:key', {
    schema: { tags: ['uploads'], response: { 404: api.ErrorResponse } },
    handler: async (request, reply) => {
      const { key } = KeyParam.parse(request.params);
      if (!isAssetKey(key)) return notFound(reply);

      const found = await deps.assets.get(key);
      if (!found) return notFound(reply);

      return (
        reply
          .header('content-type', found.contentType)
          .header('cache-control', IMMUTABLE_CACHE)
          /**
           * The type is decided by the magic bytes at upload; this stops a browser overriding that
           * by guessing, which is the step that turns a mislabelled file into a script execution.
           */
          .header('x-content-type-options', 'nosniff')
          /** Belt and braces: nothing here should ever be treated as a document in its own right. */
          .header('content-security-policy', "default-src 'none'; sandbox")
          .send(found.content)
      );
    },
  });
}

function notFound(reply: FastifyReply) {
  return reply.code(404).send({ error: { code: 'not-found', message: 'Not found' } });
}
