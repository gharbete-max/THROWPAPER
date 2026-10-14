import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
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
import { fillPdf, pdfFields } from '../pdf/fill.js';
import { copyPdf } from '../pdf/copy.js';
import { shrinkPdf } from '../pdf/shrink.js';

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

/** A PDF's own fields: field name to text, or to a tick. */
const FieldValues = z.record(z.union([z.string(), z.boolean()]));

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
  'no-fields': 400,
  'no-such-field': 400,
  'bad-value': 400,
  unencodable: 400,
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
  signed: 'A file carries a digital signature, which changing it removes',
  'no-fields': 'The PDF has no fields of its own to fill in',
  'no-such-field': 'A value names a field the PDF does not have',
  'bad-value': 'A value does not fit its field',
  unencodable: 'A value has letters the PDF’s own fonts cannot draw',
};

const errors = {
  400: api.ErrorResponse,
  401: api.ErrorResponse,
  409: api.ErrorResponse,
  413: api.ErrorResponse,
};

type Upload = { files: Uint8Array[]; fields: Map<string, string> };

/**
 * The multipart body of a PDF route: its files and its text fields, or `null` once the reply has
 * said why the body cannot be used (too large, too many files, none).
 */
async function readUpload(
  request: FastifyRequest,
  reply: FastifyReply,
  filesRequired = true,
): Promise<Upload | null> {
  const files: Uint8Array[] = [];
  const fields = new Map<string, string>();
  try {
    for await (const part of request.parts({
      limits: {
        files: PARSER_FILE_LIMIT,
        fileSize: MAX_FILE_BYTES,
        fields: 4,
        fieldSize: 1024 * 1024,
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
          void reply.code(413).send({
            error: {
              code: 'too-large',
              message: `A file must be ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)}MB or smaller`,
            },
          });
          return null;
        }
        files.push(new Uint8Array(content));
      } else if (typeof part.value === 'string') {
        fields.set(part.fieldname, part.value);
      }
    }
  } catch (error) {
    // The parser's own limit errors (a field or part too large) carry a code of this shape.
    if (((error as { code?: string }).code ?? '').startsWith('FST_')) {
      void reply.code(413).send({
        error: { code: 'too-large', message: 'The request is too large' },
      });
      return null;
    }
    throw error;
  }

  if (files.length > MAX_FILES) {
    void reply.code(413).send({
      error: { code: 'too-many-files', message: `At most ${MAX_FILES} files at once` },
    });
    return null;
  }
  if (files.length === 0 && filesRequired) {
    void reply.code(400).send({
      error: {
        code: 'no-file',
        message: 'Send at least one PDF or photograph as multipart form data',
      },
    });
    return null;
  }
  return { files, fields };
}

/** A refusal as the reply a screen can show; anything else is a bug and rethrown. */
function refuse(reply: FastifyReply, error: unknown) {
  if (error instanceof ArrangeRefusal) {
    return reply.code(STATUS[error.code]).send({
      error: { code: error.code, message: MESSAGE[error.code] },
    });
  }
  throw error;
}

const jsonOf = (text: string | undefined): unknown => {
  try {
    return JSON.parse(text ?? '');
  } catch {
    return undefined;
  }
};

function sendPdf(reply: FastifyReply, pdf: Uint8Array) {
  return reply
    .header('content-type', 'application/pdf')
    .header('content-disposition', 'attachment; filename="loppa.pdf"')
    .header('cache-control', 'no-store')
    .send(Buffer.from(pdf));
}

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
    schema: { tags: ['pdf'], response: errors },
    handler: async (request, reply) => {
      const upload = await readUpload(request, reply);
      if (!upload) return;
      const parsed = Plan.safeParse(jsonOf(upload.fields.get('plan')));
      if (!parsed.success) {
        return reply.code(400).send({
          error: { code: 'bad-plan', message: 'Send a plan: a JSON list of {file, page, rotate?}' },
        });
      }
      try {
        return sendPdf(
          reply,
          await arrangePdf(upload.files, parsed.data, {
            acceptSignatureLoss: upload.fields.get('acceptSignatureLoss') === 'true',
          }),
        );
      } catch (error) {
        return refuse(reply, error);
      }
    },
  });

  /**
   * A digital copy of a photographed page as a PDF (`pdf/copy.ts`): the lines and words the browser
   * read, drawn. Multipart: a `copy` field holding `api.CopyPdfRequest` JSON, and, for the
   * searchable kind, the photograph as the one `file`. Nothing is stored. Any signed-in person.
   * `x-copy-replaced` says how many characters no font could print (drawn as "?").
   */
  app.post('/v1/pdf/copy', {
    preHandler: requireAuth(deps.guard),
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: { tags: ['pdf'], response: errors },
    handler: async (request, reply) => {
      const upload = await readUpload(request, reply, false);
      if (!upload) return;
      const parsed = api.CopyPdfRequest.safeParse(jsonOf(upload.fields.get('copy')));
      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'bad-copy',
            message: 'Send a copy: the page size, its lines and its words',
          },
        });
      }
      try {
        const made = await copyPdf(parsed.data, upload.files[0]);
        return sendPdf(reply.header('x-copy-replaced', String(made.replaced)), made.pdf);
      } catch (error) {
        return refuse(reply, error);
      }
    },
  });

  /**
   * The fields a PDF carries of its own, for a screen to draw as a form. Multipart: one `file`,
   * and `acceptSignatureLoss` as for arranging (the screen asks first, so the fill that follows
   * does not surprise anybody).
   */
  app.post('/v1/pdf/fields', {
    preHandler: requireAuth(deps.guard),
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: { tags: ['pdf'], response: errors },
    handler: async (request, reply) => {
      const upload = await readUpload(request, reply);
      if (!upload) return;
      try {
        return reply.header('cache-control', 'no-store').send({
          fields: await pdfFields(upload.files[0]!, {
            acceptSignatureLoss: upload.fields.get('acceptSignatureLoss') === 'true',
          }),
        });
      } catch (error) {
        return refuse(reply, error);
      }
    },
  });

  /**
   * A PDF's own fields written and the PDF handed back (`pdf/fill.ts`). The person's own
   * document: nothing is stored, no submission is made and nothing is published. `values` is a
   * JSON object of field name to text or tick; `acceptSignatureLoss` = `true` once told a
   * signature goes.
   */
  app.post('/v1/pdf/fill', {
    preHandler: requireAuth(deps.guard),
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: { tags: ['pdf'], response: errors },
    handler: async (request, reply) => {
      const upload = await readUpload(request, reply);
      if (!upload) return;
      const values = FieldValues.safeParse(jsonOf(upload.fields.get('values')));
      if (!values.success) {
        return reply.code(400).send({
          error: {
            code: 'bad-values',
            message: 'Send values: a JSON object of field to text or tick',
          },
        });
      }
      try {
        return sendPdf(
          reply,
          await fillPdf(upload.files[0]!, values.data, {
            acceptSignatureLoss: upload.fields.get('acceptSignatureLoss') === 'true',
          }),
        );
      } catch (error) {
        return refuse(reply, error);
      }
    },
  });

  /**
   * A PDF written again smaller (`pdf/shrink.ts`), for Send's "Make smaller". The person's own
   * document: nothing is stored. The same bytes come back when nothing could be gained.
   */
  app.post('/v1/pdf/shrink', {
    preHandler: requireAuth(deps.guard),
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: { tags: ['pdf'], response: errors },
    handler: async (request, reply) => {
      const upload = await readUpload(request, reply);
      if (!upload) return;
      try {
        return sendPdf(reply, await shrinkPdf(upload.files[0]!));
      } catch (error) {
        return refuse(reply, error);
      }
    },
  });
}
