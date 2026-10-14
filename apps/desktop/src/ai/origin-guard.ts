/**
 * Only the Forms window's own origin is answered on the AI channels: a page that got into another
 * window, or a frame inside Forms from elsewhere, is refused (ADR 0023, ADR 0024).
 */
export interface IpcEventLike {
  senderFrame?: { url: string } | null;
}

export interface IpcMainLike {
  handle(channel: string, listener: (event: IpcEventLike, ...args: unknown[]) => unknown): void;
}

export function originGuard(allowedOrigins: () => string[]) {
  return <A extends unknown[], R>(run: (...args: A) => R) =>
    (event: IpcEventLike, ...args: unknown[]): R => {
      const url = event.senderFrame?.url ?? '';
      if (!allowedOrigins().some((origin) => url === origin || url.startsWith(`${origin}/`))) {
        throw new Error('not-the-forms-window');
      }
      return run(...(args as A));
    };
}
