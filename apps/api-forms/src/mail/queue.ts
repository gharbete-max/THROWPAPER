import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { z } from 'zod';
import type { MailProvider, OutboundMail } from './provider.js';

/**
 * Mail that waits for a person to press Send — the desktop's default (ADR 0016, "offline first").
 *
 * The offline edition sends nothing by itself. Every message the product would have sent — a
 * confirmation with its admission card, the organiser's notice, a signer's invitation — is kept
 * here instead, in the workspace (so a backup carries it), and the **To send** screen opens each
 * one as a draft in the person's own mail program, addressed and with its attachment, for them to
 * send from their own account. Nothing leaves the computer until they do (rule 7).
 *
 * One folder per message: `message.json` and the attachments beside it, by index, so no name a
 * stranger chose ever becomes a path. Written to a temporary name and renamed, so a message is
 * either all there or not listed.
 */
export interface QueuedAttachment {
  filename: string;
  contentType: string;
  bytes: number;
}

export interface QueuedMail {
  id: string;
  to: string;
  subject: string;
  text: string;
  attachments: QueuedAttachment[];
  createdAt: string;
  /** When it was last opened as a draft. Whether it was then sent is the mail program's to know. */
  openedAt: string | null;
}

export interface OutgoingStore {
  list(): Promise<QueuedMail[]>;
  get(id: string): Promise<QueuedMail | null>;
  attachment(
    id: string,
    index: number,
  ): Promise<{ meta: QueuedAttachment; content: Buffer } | null>;
  markOpened(id: string, at?: Date): Promise<QueuedMail | null>;
  remove(id: string): Promise<boolean>;
}

const Stored = z.object({
  id: z.string().uuid(),
  to: z.string(),
  subject: z.string(),
  text: z.string(),
  attachments: z.array(
    z.object({ filename: z.string(), contentType: z.string(), bytes: z.number().int().min(0) }),
  ),
  createdAt: z.string(),
  openedAt: z.string().nullable(),
});

/** Only an id this store made names a folder: anything else is not a path to try. */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function createOutgoingStore(directory: string, now: () => Date = () => new Date()) {
  async function read(id: string): Promise<QueuedMail | null> {
    if (!ID.test(id)) return null;
    try {
      return Stored.parse(JSON.parse(await readFile(join(directory, id, 'message.json'), 'utf8')));
    } catch {
      return null;
    }
  }

  async function write(message: QueuedMail): Promise<void> {
    const temporary = join(directory, message.id, 'message.json.tmp');
    await writeFile(temporary, JSON.stringify(message, null, 2), { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, join(directory, message.id, 'message.json'));
  }

  const store: OutgoingStore & { add(mail: OutboundMail): Promise<QueuedMail> } = {
    async add(mail) {
      const id = randomUUID();
      const folder = join(directory, id);
      await mkdir(folder, { recursive: true });
      const attachments = mail.attachments ?? [];
      for (const [index, attachment] of attachments.entries()) {
        await writeFile(join(folder, `attachment-${index}`), attachment.content, { mode: 0o600 });
      }
      const message: QueuedMail = {
        id,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        attachments: attachments.map((attachment) => ({
          // Its own name, minus anything that is not a name: it becomes a file in a mail program.
          filename:
            basename(attachment.filename.replace(/[\\/]/g, '_')).replace(
              // eslint-disable-next-line no-control-regex
              /[\x00-\x1f]/g,
              '_',
            ) || 'attachment',
          contentType: attachment.contentType,
          bytes: attachment.content.length,
        })),
        createdAt: now().toISOString(),
        openedAt: null,
      };
      await write(message);
      return message;
    },

    async list() {
      const entries = await readdir(directory).catch(() => [] as string[]);
      const messages = (await Promise.all(entries.map(read))).filter(
        (message): message is QueuedMail => message !== null,
      );
      // Waiting first, then the ones already opened; newest first within each.
      return messages.sort(
        (a, b) =>
          Number(a.openedAt !== null) - Number(b.openedAt !== null) ||
          b.createdAt.localeCompare(a.createdAt),
      );
    },

    get: read,

    async attachment(id, index) {
      const message = await read(id);
      const meta = message?.attachments[index];
      if (!message || !meta || !Number.isInteger(index)) return null;
      try {
        return { meta, content: await readFile(join(directory, id, `attachment-${index}`)) };
      } catch {
        return null;
      }
    },

    async markOpened(id, at = now()) {
      const message = await read(id);
      if (!message) return null;
      const opened = { ...message, openedAt: at.toISOString() };
      await write(opened);
      return opened;
    },

    async remove(id) {
      if (!(await read(id))) return false;
      await rm(join(directory, id), { recursive: true, force: true });
      return true;
    },
  };
  return store;
}

export type OutgoingQueue = ReturnType<typeof createOutgoingStore>;

/**
 * The provider every job and route sends through, unchanged, on a desktop set to "open in my
 * email program": `send` keeps the message for the person instead of sending it.
 */
export function createQueueMailProvider(queue: OutgoingQueue): MailProvider {
  return {
    name: 'queue',
    async send(mail) {
      const queued = await queue.add(mail);
      return { messageId: `queue-${queued.id}` };
    },
  };
}
