import type { FastifyReply, FastifyRequest } from 'fastify';
import { MAX_FILE_BYTES } from '../pdf/arrange.js';

/**
 * The parser's own file limit is set well above ours. Reaching it fails the whole request stream
 * (`FST_FILES_LIMIT`, then a premature close), so the count that matters is made here, and files
 * past it are read and thrown away.
 */
const PARSER_FILE_LIMIT = 100;

export interface PdfUpload {
  files: Uint8Array[];
  fields: Map<string, string>;
}

/**
 * Reads a multipart request of `file` parts and short text fields. When the request is too large
 * or has too many files, the reply has been sent and `null` comes back.
 */
export async function readPdfUpload(
  request: FastifyRequest,
  reply: FastifyReply,
  maxFiles: number,
): Promise<PdfUpload | null> {
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
        if (files.length > maxFiles) {
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
  if (files.length > maxFiles) {
    void reply.code(413).send({
      error: { code: 'too-many-files', message: `At most ${maxFiles} files at once` },
    });
    return null;
  }
  return { files, fields };
}

/** A finished PDF as a download that nothing caches. */
export function sendPdf(reply: FastifyReply, pdf: Uint8Array) {
  return reply
    .header('content-type', 'application/pdf')
    .header('content-disposition', 'attachment; filename="loppa.pdf"')
    .header('cache-control', 'no-store')
    .send(Buffer.from(pdf));
}
