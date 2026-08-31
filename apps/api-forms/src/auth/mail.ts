/**
 * The seam the real provider plugs into in phase 4.
 *
 * v0.1 has no mailer yet, so the console transport prints the link. This also satisfies
 * CLAUDE.md rule 7 — "every outbound action has a test mode" — and the memory transport is what
 * the tests assert against.
 */
export interface OutboundMail {
  to: string;
  subject: string;
  text: string;
}

export interface MailTransport {
  send(mail: OutboundMail): Promise<void>;
}

export function createConsoleMailTransport(log: (message: string) => void): MailTransport {
  return {
    send: async (mail) => {
      log(
        `\n--- mail (console transport) ---\nto: ${mail.to}\n${mail.subject}\n${mail.text}\n---\n`,
      );
    },
  };
}

export function createMemoryMailTransport(): MailTransport & { sent: OutboundMail[] } {
  const sent: OutboundMail[] = [];
  return { sent, send: async (mail) => void sent.push(mail) };
}
