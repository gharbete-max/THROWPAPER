import { deflateSync } from 'node:zlib';

/**
 * A few megabytes that cost seconds and hundreds of megabytes to open: an object stream declaring
 * hundreds of thousands of tiny objects, deflated. Unguarded, pdf-lib held the event loop 7.2 s
 * for 2.9 MB of this, measured.
 */
export function objectStreamBomb(count: number): Buffer {
  let header = '';
  let body = '';
  for (let i = 0; i < count; i += 1) {
    header += `${i + 10} ${body.length} `;
    body += `<</A ${i}>>\n`;
  }
  const stream = deflateSync(Buffer.from(header + body, 'latin1'), { level: 9 });
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>',
  ];
  let head = '%PDF-1.7\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(head.length);
    head += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  offsets.push(head.length);
  head += `4 0 obj\n<< /Type /ObjStm /N ${count} /First ${Buffer.byteLength(header)} /Filter /FlateDecode /Length ${stream.length} >>\nstream\n`;
  const before = Buffer.concat([
    Buffer.from(head, 'latin1'),
    stream,
    Buffer.from('\nendstream\nendobj\n', 'latin1'),
  ]);
  const xref =
    `xref\n0 5\n0000000000 65535 f \n` +
    offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${before.length}\n%%EOF\n`;
  return Buffer.concat([before, Buffer.from(xref, 'latin1')]);
}
