import { z } from 'zod';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { api } from '@tp/shared';
import type { AuthGuardDeps } from '../auth/plugin.js';
import { requireAuth } from '../auth/plugin.js';
import type { Repositories } from '../db/repositories/index.js';
import { recordAudit } from '../audit.js';
import { checkImage, MAX_IMAGE_BYTES } from '../uploads/image.js';
import { assetPath, isAssetKey, type AssetStore } from '../uploads/store.js';
import type { PrivateUploadStore } from '../uploads/private-store.js';
import {
  checkAttachment,
  contentTypeFor,
  type AttachmentRejection,
} from '../uploads/attachment.js';
import { resolveFormAccess } from '../forms/access.js';
import {
  canEdit,
  FormDefinition,
  isUploadKey,
  MAX_UPLOAD_BYTES,
  type UploadExtension,
} from '@tp/shared/forms';

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
  deps: {
    repos: Repositories;
    guard: AuthGuardDeps;
    assets: AssetStore;
    uploadStore: PrivateUploadStore;
  },
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
   * Read a file a respondent attached. **Authenticated, and scoped to the submission.**
   *
   * Not a signed URL. The documents store uses one for a bulk export and says why it is
   * acceptable there; here it is not, because a signed URL is a bearer token written into a link,
   * and a link gets forwarded, logged and pasted into chat. Somebody's CV should need a session,
   * not a string.
   *
   * The lookup is the first half of the access control: a row matching this organisation, this
   * submission and this key, or nothing. The key alone proves nothing — it is the hash of the
   * content, so anybody holding the same file can compute it. The second half is the form's own
   * rules, because a respondent's file belongs to the form that collected it: "same organisation"
   * let any operator with a session read the CVs sent to a colleague's private form (audit 13).
   *
   * Served as an attachment with the type read from the bytes at upload, never the one declared,
   * so an HTML file renamed `.pdf` cannot execute against this origin.
   */
  app.get('/v1/submissions/:submissionId/files/:key', {
    preHandler: requireAuth(deps.guard),
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    schema: {
      tags: ['uploads'],
      params: z.object({
        submissionId: z.string().uuid(),
        key: z.string().min(1).max(128),
      }),
      response: { 401: api.ErrorResponse, 403: api.ErrorResponse, 404: api.ErrorResponse },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) {
        return reply
          .code(401)
          .send({ error: { code: 'unauthenticated', message: 'Sign in to continue' } });
      }

      const params = z
        .object({ submissionId: z.string().uuid(), key: z.string().min(1).max(128) })
        .parse(request.params);

      if (!isUploadKey(params.key)) return notFound(reply);

      const record = await deps.repos.uploads.findForDownload(
        auth.organisation.id,
        params.submissionId,
        params.key,
      );
      if (!record) return notFound(reply);
      if (!(await resolveFormAccess(deps.repos, auth, record.formId))) return notFound(reply);

      const content = await deps.uploadStore.get(record.storageKey);
      if (!content) return notFound(reply);

      return (
        reply
          .header('content-type', record.contentType)
          // Always an attachment: nothing uploaded by a stranger renders inline on this origin.
          .header('content-disposition', `attachment; filename="${asciiFilename(record.filename)}"`)
          .header('cache-control', 'private, no-store')
          .send(content)
      );
    },
  });

  /**
   * Serve an uploaded image. **No authentication**, on purpose: a logo is painted on a public form
   * that anybody can open, so anything else would break the page for the people it is for.
   *
   * What protects this is that the key is the SHA-256 of the content. It cannot be guessed, it
   * cannot be enumerated, and it cannot encode a path. Note the contrast with the route above:
   * these are an author's images, meant to be seen; those are a stranger's personal files.
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

  /**
   * The paper a form is being made from — a PDF, or a photograph of a page.
   *
   * `docs/adr/0004-old-forms-on-paper.md`. Stored in the **private** store, like a respondent's
   * attachment, because an old membership form is an organisation's document and not a logo.
   * This route only stores the bytes: the client writes the key into `definition.paper` and saves
   * the draft as usual, so undo, versions and publish need no new code to know about it.
   */
  app.post('/v1/forms/:id/paper', {
    preHandler: requireAuth(deps.guard),
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['uploads'],
      params: FormIdParam,
      response: {
        201: PaperResponse,
        400: api.ErrorResponse,
        401: api.ErrorResponse,
        403: api.ErrorResponse,
        404: api.ErrorResponse,
        413: api.ErrorResponse,
      },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const { id } = FormIdParam.parse(request.params);

      const found = await resolveFormAccess(deps.repos, auth, id);
      if (!found) return notFound(reply);
      if (!canEdit(found.access)) {
        return reply
          .code(403)
          .send({ error: { code: 'forbidden', message: 'You cannot change this form' } });
      }

      const file = await request.file({ limits: { fileSize: MAX_UPLOAD_BYTES } });
      if (!file) {
        return reply
          .code(400)
          .send({ error: { code: 'no-file', message: 'Send one file as multipart form data' } });
      }
      const content = await file.toBuffer();
      if (file.file.truncated) {
        return reply.code(413).send({ error: { code: 'too-large', message: tooLarge() } });
      }

      // The bytes decide what this is; the filename and declared type are the uploader's words.
      const checked = checkAttachment(content, 'both');
      if (!checked.ok) {
        const status = checked.code === 'too-large' ? 413 : 400;
        return reply
          .code(status)
          .send({ error: { code: checked.code, message: attachmentMessage(checked.code) } });
      }

      const stored = await deps.uploadStore.put(content, checked.extension);
      await recordAudit(deps.repos, request, {
        action: 'form.paper.add',
        entityType: 'form',
        entityId: id,
        after: { key: stored.key, bytes: stored.bytes, contentType: checked.contentType },
      });

      return reply
        .code(201)
        .send({ key: stored.key, contentType: checked.contentType, bytes: stored.bytes });
    },
  });

  /**
   * Read a form's paper back, to draw on in the builder.
   *
   * Authenticated and scoped through the form: the key must be one the current draft lists.
   * That list *is* the ownership record — a key that is not in it is not this form's file, whoever
   * else may have uploaded identical bytes.
   */
  app.get('/v1/forms/:id/paper/:key', {
    preHandler: requireAuth(deps.guard),
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    schema: {
      tags: ['uploads'],
      params: PaperParam,
      response: { 401: api.ErrorResponse, 404: api.ErrorResponse },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const { id, key } = PaperParam.parse(request.params);
      if (!isUploadKey(key)) return notFound(reply);

      const found = await resolveFormAccess(deps.repos, auth, id);
      if (!found) return notFound(reply);

      const draft = FormDefinition.safeParse(found.form.draftDefinition);
      const listed = draft.success && draft.data.paper?.sources.some((s) => s.key === key);
      if (!listed) return notFound(reply);

      const content = await deps.uploadStore.get(key);
      if (!content) return notFound(reply);

      return reply
        .header('content-type', contentTypeFor(key.split('.')[1] as UploadExtension))
        .header('cache-control', 'private, no-store')
        .header('x-content-type-options', 'nosniff')
        .header('content-security-policy', "default-src 'none'; sandbox")
        .send(content);
    },
  });
}

const FormIdParam = z.object({ id: z.string().uuid() });
const PaperParam = FormIdParam.extend({ key: z.string().min(1).max(128) });
const PaperResponse = z.object({
  key: z.string(),
  contentType: z.string(),
  bytes: z.number().int().nonnegative(),
});

function tooLarge(): string {
  return `Files must be ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB or smaller`;
}

function attachmentMessage(code: AttachmentRejection['code']): string {
  switch (code) {
    case 'too-large':
      return tooLarge();
    case 'empty':
      return 'The file is empty';
    default:
      return 'Send a PDF or a photograph (PNG, JPEG or WebP)';
  }
}

function unauthenticated(reply: FastifyReply) {
  return reply
    .code(401)
    .send({ error: { code: 'unauthenticated', message: 'Sign in to continue' } });
}

function notFound(reply: FastifyReply) {
  return reply.code(404).send({ error: { code: 'not-found', message: 'Not found' } });
}

/**
 * A filename safe to put in a header.
 *
 * `Content-Disposition` is parsed by the browser, so a quote or a newline in a name somebody
 * chose would let them write their own header fields. Non-ASCII is dropped rather than encoded:
 * the name is a convenience, and `RFC 5987` encoding is not worth the surface here.
 */
function asciiFilename(filename: string): string {
  // ` ` to `~` is exactly the printable ASCII range; the second pass drops the two characters
  // that would end the quoted string early.
  const cleaned = filename.replace(/[^ -~]/g, '').replace(/["\\]/g, '');
  return cleaned.trim() || 'attachment';
}
