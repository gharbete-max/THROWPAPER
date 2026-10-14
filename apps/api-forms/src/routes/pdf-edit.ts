import { z } from 'zod';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { api } from '@tp/shared';
import type { AuthGuardDeps } from '../auth/plugin.js';
import { requireAuth } from '../auth/plugin.js';
import {
  editPdf,
  EditRefusal,
  MAX_REDACTED_PAGES,
  redactPdf,
  type EditRefusalCode,
} from '../pdf/edit.js';
import { readPdfUpload, sendPdf } from './pdf-upload.js';

const Ops = z.array(
  z.union([
    z.object({
      page: z.number().int(),
      x: z.number(),
      y: z.number(),
      text: z.string(),
      size: z.number(),
      color: z.string().optional(),
    }),
    z.object({
      page: z.number().int(),
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
      image: z.string(),
    }),
    z.object({
      page: z.number().int(),
      rect: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
      fill: z.string(),
    }),
  ]),
);
const Pages = z.array(z.number().int());
const ImageNames = z.array(z.string()).max(8);

const STATUS: Record<EditRefusalCode, 400 | 409> = {
  unreadable: 400,
  'too-costly': 400,
  encrypted: 400,
  signed: 409,
  'no-ops': 400,
  'too-many-ops': 400,
  'no-such-page': 400,
  'bad-op': 400,
  'unsupported-glyphs': 400,
  'font-unavailable': 400,
  'bad-image': 400,
  'image-too-large': 400,
  'cannot-redact-safely': 400,
};

const MESSAGE: Record<EditRefusalCode, string> = {
  unreadable: 'The file is not a PDF that can be opened',
  'too-costly': 'The file is too costly to open',
  encrypted: 'The file is protected with a password or encryption',
  signed: 'The file carries a digital signature, which changing it removes',
  'no-ops': 'Nothing to do',
  'too-many-ops': 'Too many changes at once',
  'no-such-page': 'A change names a page the file does not have',
  'bad-op': 'A change is not valid: check its numbers, text and colour',
  'unsupported-glyphs': 'The text has characters that no available font can print',
  'font-unavailable': 'This server has no font for some of the characters',
  'bad-image': 'A page picture is not a PNG that can be used',
  'image-too-large': 'A page picture has more pixels than a page can use',
  'cannot-redact-safely':
    'This PDF links its pages together so that a redacted page cannot be removed completely',
};

function refuse(reply: FastifyReply, error: EditRefusal) {
  return reply.code(STATUS[error.code]).send({
    error: {
      code: error.code,
      message: MESSAGE[error.code],
      ...(error.characters.length > 0 ? { fields: { characters: error.characters } } : {}),
    },
  });
}

const schema = {
  tags: ['pdf'],
  response: {
    400: api.ErrorResponse,
    401: api.ErrorResponse,
    409: api.ErrorResponse,
    413: api.ErrorResponse,
  },
};

export function registerPdfEditRoutes(app: FastifyInstance, deps: { guard: AuthGuardDeps }): void {
  /**
   * Text on a PDF (`pdf/edit.ts`). Multipart: the PDF as the first `file`, an `ops` field with the
   * JSON list `[{page, x, y, text, size, color?} | {page, rect: {x, y, width, height}, fill} |
   * {page, x, y, width, height, image}]` (points from the lower left, pages from 0), and
   * `acceptSignatureLoss` = `true` once the person has been told. A picture op names a PNG: further
   * `file`s are PNGs, called in order by the names in an `images` field (a JSON list of names).
   */
  app.post('/v1/pdf/edit', {
    preHandler: requireAuth(deps.guard),
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema,
    handler: async (request, reply) => {
      const upload = await readPdfUpload(request, reply, 9);
      if (!upload) return reply;
      let ops: z.infer<typeof Ops>;
      try {
        ops = Ops.parse(JSON.parse(upload.fields.get('ops') ?? ''));
      } catch {
        return reply.code(400).send({
          error: { code: 'bad-ops', message: 'Send `ops`: a JSON list of text and cover changes' },
        });
      }
      let names: string[];
      try {
        names = upload.fields.has('images')
          ? ImageNames.parse(JSON.parse(upload.fields.get('images')!))
          : [];
      } catch {
        return reply.code(400).send({
          error: { code: 'bad-ops', message: 'Send `images`: a JSON list of picture names' },
        });
      }
      if (upload.files.length !== 1 + names.length) {
        return reply.code(400).send({
          error: { code: 'no-file', message: 'Send the PDF, then one PNG for each name' },
        });
      }
      try {
        return sendPdf(
          reply,
          await editPdf(upload.files[0]!, ops, {
            acceptSignatureLoss: upload.fields.get('acceptSignatureLoss') === 'true',
            images: new Map(names.map((name, i) => [name, upload.files[i + 1]!])),
          }),
        );
      } catch (error) {
        if (error instanceof EditRefusal) return refuse(reply, error);
        throw error;
      }
    },
  });

  /**
   * True redaction (`pdf/edit.ts`). Multipart: the PDF as the first `file`, then one PNG `file` per
   * page to replace, in the order of the `pages` field (a JSON list of page numbers from 0). Each PNG
   * is the page as the person sees it with the boxes burnt in; it replaces the page whole.
   */
  app.post('/v1/pdf/redact', {
    preHandler: requireAuth(deps.guard),
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema,
    handler: async (request, reply) => {
      const upload = await readPdfUpload(request, reply, MAX_REDACTED_PAGES + 1);
      if (!upload) return reply;
      let pages: number[];
      try {
        pages = Pages.parse(JSON.parse(upload.fields.get('pages') ?? ''));
      } catch {
        return reply.code(400).send({
          error: { code: 'bad-pages', message: 'Send `pages`: a JSON list of page numbers' },
        });
      }
      const [pdf, ...images] = upload.files;
      if (!pdf || images.length !== pages.length) {
        return reply.code(400).send({
          error: { code: 'no-file', message: 'Send the PDF, then one PNG for each page named' },
        });
      }
      try {
        return sendPdf(
          reply,
          await redactPdf(
            pdf,
            pages.map((page, i) => ({ page, image: images[i]! })),
            { acceptSignatureLoss: upload.fields.get('acceptSignatureLoss') === 'true' },
          ),
        );
      } catch (error) {
        if (error instanceof EditRefusal) return refuse(reply, error);
        throw error;
      }
    },
  });
}
