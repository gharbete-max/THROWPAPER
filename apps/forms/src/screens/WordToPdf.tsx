import { useRef, useState } from 'react';
import { client } from '../lib/api.js';
import { useT } from '../lib/i18n.js';
import { useSession } from '../lib/session.js';
import { useToast } from '../lib/toast.js';
import { Icon } from '../components/Icon.js';
import { readWordBlocks, type Dropped, type DroppedKind } from './builder/paper/docx-blocks.js';
import { DocxRefused } from './builder/paper/refusal.js';

const DROPPED = {
  headerFooter: 'scan.word.drop.headerFooter',
  textBox: 'scan.word.drop.textBox',
  footnote: 'scan.word.drop.footnote',
  trackedChange: 'scan.word.drop.trackedChange',
  field: 'scan.word.drop.field',
  image: 'scan.word.drop.image',
} as const satisfies Record<DroppedKind, string>;

/** The PDFs this made, so the Scan screen can carry their label into the file it downloads. */
export const fromWord = new WeakSet<File>();

/** Text fit to be in a file's name: nothing a filesystem refuses, and no control characters. */
const nameSafe = (text: string) =>
  [...text]
    .map((c) => (c.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(c) ? ' ' : c))
    .join('')
    .trim();

/**
 * A Word file made into a rough PDF and handed to the page list (Phase 1c). The file is read in
 * this browser; only the blocks it kept go to the server (`POST /v1/pdf/word`). The screen says,
 * every time, that the layout may differ from Word, and names each kind of part the PDF leaves out
 * with how many there were. The label is in the file's name too, so it travels with the PDF.
 */
export function WordToPdf({ onPdf }: { onPdf: (file: File) => void }) {
  const t = useT();
  const toast = useToast();
  const { contentLocale } = useSession();
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dropped, setDropped] = useState<Dropped[]>([]);

  async function convert(file: File) {
    setBusy(true);
    setDropped([]);
    try {
      const read = await readWordBlocks(await file.arrayBuffer());
      if (read.blocks.length === 0) throw new DocxRefused('unreadable', 'no content');
      const pdf = await client.wordToPdf({ blocks: read.blocks, lang: contentLocale });
      // The label rides in the name, with what a filesystem will not take removed.
      const stem = nameSafe(file.name.replace(/\.docx$/i, ''));
      const made = new File([pdf], `${stem} (${nameSafe(t('scan.word.label'))}).pdf`, {
        type: 'application/pdf',
      });
      fromWord.add(made);
      onPdf(made);
      setDropped(read.dropped);
    } catch (error) {
      toast.show(
        error instanceof DocxRefused ? t(`paper.docx.${error.reason}`) : t('scan.error.failed'),
        'error',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack stack--tight" data-testid="scan-word">
      <input
        ref={picker}
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        hidden
        data-testid="scan-word-file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void convert(file);
        }}
      />
      <div className="scan__bar">
        <button
          type="button"
          className="button button--quiet"
          disabled={busy}
          onClick={() => picker.current?.click()}
        >
          <Icon name="upload" /> {busy ? t('scan.word.working') : t('scan.word.add')}
        </button>
        <span className="muted small">{t('scan.word.label')}</span>
      </div>
      {dropped.length > 0 ? (
        <div className="small" role="status" data-testid="scan-word-dropped">
          <p>{t('scan.word.dropped')}</p>
          <ul>
            {dropped.map((item) => (
              <li key={item.kind}>{t(DROPPED[item.kind], { count: item.count })}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
