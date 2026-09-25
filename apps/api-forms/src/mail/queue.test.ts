import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createOutgoingStore, createQueueMailProvider } from './queue.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'loppa-queue-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const card = {
  filename: 'Björn-Ödlund-K7M2.pdf',
  contentType: 'application/pdf',
  content: Buffer.from('%PDF-1.7 card'),
};

describe('mail waiting for somebody to press Send', () => {
  it('keeps what a provider was given — nothing is sent — with its attachment', async () => {
    const queue = createOutgoingStore(dir);
    const provider = createQueueMailProvider(queue);
    const sent = await provider.send({
      to: 'bjorn@example.com',
      subject: 'Din anmälan är bekräftad',
      text: 'Tack.',
      html: '<p>Tack.</p>',
      attachments: [card],
    });

    expect(provider.name).toBe('queue');
    const [message] = await queue.list();
    expect(sent.messageId).toBe(`queue-${message!.id}`);
    expect(message).toMatchObject({
      to: 'bjorn@example.com',
      subject: 'Din anmälan är bekräftad',
      text: 'Tack.',
      openedAt: null,
      attachments: [{ filename: 'Björn-Ödlund-K7M2.pdf', contentType: 'application/pdf' }],
    });
    const attachment = await queue.attachment(message!.id, 0);
    expect(attachment?.content.toString()).toBe('%PDF-1.7 card');
    // Private to the person whose workspace it is.
    expect((await stat(join(dir, message!.id, 'message.json'))).mode & 0o777).toBe(0o600);
  });

  it('lists waiting messages first, newest first, then the ones already opened', async () => {
    let clock = Date.parse('2026-05-14T09:00:00Z');
    const queue = createOutgoingStore(dir, () => new Date((clock += 1000)));
    const first = await queue.add({ to: 'a@example.com', subject: 'A', text: '' });
    const second = await queue.add({ to: 'b@example.com', subject: 'B', text: '' });
    const third = await queue.add({ to: 'c@example.com', subject: 'C', text: '' });
    await queue.markOpened(third.id);

    expect((await queue.list()).map((message) => message.subject)).toEqual(['B', 'A', 'C']);
    expect((await queue.get(third.id))?.openedAt).not.toBeNull();
    expect(first.openedAt).toBeNull();
    expect(second.openedAt).toBeNull();
  });

  it('removes a message and its files', async () => {
    const queue = createOutgoingStore(dir);
    const message = await queue.add({
      to: 'a@example.com',
      subject: 'A',
      text: '',
      attachments: [card],
    });
    expect(await queue.remove(message.id)).toBe(true);
    expect(await readdir(dir)).toEqual([]);
    expect(await queue.remove(message.id)).toBe(false);
  });

  it('never turns an id or an attachment name into somewhere else on disk', async () => {
    const queue = createOutgoingStore(dir);
    const message = await queue.add({
      to: 'a@example.com',
      subject: 'A',
      text: '',
      attachments: [{ ...card, filename: '../../secrets.json' }],
    });
    expect(message.attachments[0]!.filename).toBe('.._.._secrets.json');
    for (const id of ['..', '../secrets.json', `${message.id}/../..`, '']) {
      expect(await queue.get(id)).toBeNull();
      expect(await queue.remove(id)).toBe(false);
    }
    expect(await queue.attachment(message.id, 1)).toBeNull();
    expect(await queue.attachment(message.id, -1)).toBeNull();
  });
});
