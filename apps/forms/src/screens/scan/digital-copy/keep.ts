import {
  copySvg,
  copyText,
  pdfRequestOf,
  type DigitalCopy,
  type SvgStyle,
} from '@tp/shared/import';
import { client } from '../../../lib/api.js';
import { saveBlob } from '../../../lib/email-handoff.js';

/**
 * Keeping a digital copy: the only file of this screen that reaches the server, and only for a
 * PDF, which the server draws (`POST /v1/pdf/copy`, nothing stored). The SVG and the text are
 * made here. Each is something the person pressed a button for.
 */

/** A PDF, saved. Returns how many characters no PDF font could draw (shown as "?"). */
export async function keepPdf(
  copy: DigitalCopy,
  mode: 'copy' | 'searchable',
  picture: Blob,
): Promise<number> {
  let replaced = 0;
  const blob = await client.copyPdf(
    pdfRequestOf(copy, mode),
    mode === 'searchable' ? picture : undefined,
    (headers) => {
      replaced = Number(headers.get('x-copy-replaced') ?? 0) || 0;
    },
  );
  saveBlob(blob, mode === 'searchable' ? 'loppa-searchable.pdf' : 'loppa-copy.pdf');
  return replaced;
}

export function keepSvg(copy: DigitalCopy, style: SvgStyle): void {
  saveBlob(new Blob([copySvg(copy, style)], { type: 'image/svg+xml' }), 'loppa-copy.svg');
}

export function keepText(copy: DigitalCopy): void {
  saveBlob(new Blob([copyText(copy)], { type: 'text/plain;charset=utf-8' }), 'loppa-copy.txt');
}

/** A blank form for the page to be read into: its id, to open the paper import on. */
export async function startForm(title: Record<string, string>): Promise<string> {
  const created = await client.createForm({
    slug: `form-${Date.now().toString(36)}`,
    title,
  });
  return created.id;
}
