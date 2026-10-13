import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { api } from '@tp/shared';
import type { AuthGuardDeps } from '../auth/plugin.js';
import { requireAuth } from '../auth/plugin.js';
import type { PdfRenderer } from '../documents/render.js';
import { wordToPdf } from '../pdf/word.js';
import {
  arrangePdf,
  ArrangeRefusal,
  MAX_FILE_BYTES,
  MAX_FILES,
  type ArrangeRefusalCode,
} from '../pdf/arrange.js';

/**
 * The parser's own file limit is set well above ours. Reaching it fails the whole request stream
 * (`FST_FILES_LIMIT`, then a premature close), so the count that matters is made here, and files
 * past it are read and thrown away.
 */
const PARSER_FILE_LIMIT = 100;

const Plan = z.array(
  z.object({
    file: z.number().int(),
    page: z.number().int(),
    rotate: z.number().int().optional(),
  }),
);

/** What a screen can show, by refusal. A file the plan could not use is a 400; a signed one a 409. */
const STATUS: Record<ArrangeRefusalCode, 400 | 409> = {
  'empty-plan': 400,
  'too-many-pages': 400,
  'no-such-file': 400,
  'no-such-page': 400,
  'bad-rotation': 400,
  unreadable: 400,
  'too-costly': 400,
  'image-too-large': 400,
  encrypted: 400,
  signed: 409,
};

const MESSAGE: Record<ArrangeRefusalCode, string> = {
  'empty-plan': 'The plan names no pages',
  'too-many-pages': 'The plan names too many pages',
  'no-such-file': 'The plan names a file that was not sent',
  'no-such-page': 'The plan names a page the file does not have',
  'bad-rotation': 'A page can be turned by 0, 90, 180 or 270 degrees',
  unreadable: 'A file is not a PDF or photograph that can be opened',
  'too-costly': 'A file is too costly to open',
  'image-too-large': 'A photograph has more pixels than a page can use',
  encrypted: 'A file is protected with a password or encryption',
  signed: 'A file carries a digital signature, which rearranging its pages removes',
};

export function registerPdfRoutes(
  app: FastifyInstance,
  deps: { guard: AuthGuardDeps; renderer: PdfRenderer },
): void {
  /**
   * A Word document, roughly, as a PDF (`pdf/word.ts`). The browser read the `.docx` and sends the
   * blocks it kept; nothing is stored. Any signed-in person.
   */
  app.post('/v1/pdf/word', {
    preHandler: requireAuth(deps.guard),
    // Eight MB of pictures is ~11 MB of base64, and the text beside them.
    bodyLimit: 16 * 1024 * 1024,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      tags: ['pdf'],
      body: api.WordPdfRequest,
      response: { 400: api.ErrorResponse, 401: api.ErrorResponse, 413: api.ErrorResponse },
    },
    handler: async (request, reply) => {
      const pdf = await wordToPdf(deps.renderer, api.WordPdfRequest.parse(request.body));
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', 'attachment; filename="loppa.pdf"')
        .header('cache-control', 'no-store')
        .send(pdf);
    },
  });

  /**
   * Put PDFs and photographs together, take pages out, turn or reorder them: one ordered list of pages in, one PDF
   * out (`pdf/arrange.ts`). Any signed-in person; nothing is stored and nothing is audited, because
   * the bytes are returned to whoever sent them and kept nowhere.
   *
   * Multipart: any number of `file` parts (the plan's `file` is the index in the order sent), a
   * `plan` field holding the JSON list `[{file, page, rotate?}]` with pages counted from 0, and
   * `acceptSignatureLoss` = `true` once the person has been told a signature will be removed.
   */
  app.post('/v1/pdf/arrange', {
    preHandler: requireAuth(deps.guard),
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      tags: ['pdf'],
      response: {
        400: api.ErrorResponse,
        401: api.ErrorResponse,
        409: api.ErrorResponse,
        413: api.ErrorResponse,
      },
    },
    handler: async (request, reply) => {
      const files: Uint8Array[] = [];
      const fields = new Map<string, string>();
      try {
        for await (const part of request.parts({
          limits: {
            files: PARSER_FILE_LIMIT,
            fileSize: MAX_FILE_BYTES,
            fields: 4,
            fieldSize: 256 * 1024,
          },
        })) {
          if (part.type === 'file') {
            // One file past the limit is enough to know; the rest are read and thrown away rather
            // than abandoned, because abandoning a half-read upload fails the request stream.
            if (files.length > MAX_FILES) {
              await part.toBuffer();
              continue;
            }
            const content = await part.toBuffer();
            if (part.file.truncated) {
              return reply.code(413).send({
                error: {
                  code: 'too-large',
                  message: `A file must be ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)}MB or smaller`,
                },
              });
            }
            files.push(new Uint8Array(content));
          } else if (typeof part.value === 'string') {
            fields.set(part.fieldname, part.value);
          }
        }
      } catch (error) {
        // The parser's own limit errors (a field or part too large) carry a code of this shape.
        if (((error as { code?: string }).code ?? '').startsWith('FST_')) {
          return reply.code(413).send({
            error: { code: 'too-large', message: 'The request is too large' },
          });
        }
        throw error;
      }

      if (files.length > MAX_FILES) {
        return reply.code(413).send({
          error: { code: 'too-many-files', message: `At most ${MAX_FILES} files at once` },
        });
      }
      if (files.length === 0) {
        return reply.code(400).send({
          error: {
            code: 'no-file',
            message: 'Send at least one PDF or photograph as multipart form data',
          },
        });
      }
      let plan: z.infer<typeof Plan>;
      try {
        plan = Plan.parse(JSON.parse(fields.get('plan') ?? ''));
      } catch {
        return reply.code(400).send({
          error: { code: 'bad-plan', message: 'Send a plan: a JSON list of {file, page, rotate?}' },
        });
      }

      try {
        const pdf = await arrangePdf(files, plan, {
          acceptSignatureLoss: fields.get('acceptSignatureLoss') === 'true',
        });
        return reply
          .header('content-type', 'application/pdf')
          .header('content-disposition', 'attachment; filename="loppa.pdf"')
          .header('cache-control', 'no-store')
          .send(Buffer.from(pdf));
      } catch (error) {
        if (error instanceof ArrangeRefusal) {
          return reply.code(STATUS[error.code]).send({
            error: { code: error.code, message: MESSAGE[error.code] },
          });
        }
        throw error;
      }
    },
  });
}
