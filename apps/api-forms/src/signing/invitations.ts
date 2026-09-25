import type { Repositories, SigningRequestRecord } from '../db/repositories/index.js';
import type { SigningRequestParty } from '../db/schema.js';
import type { JobHandler } from '../jobs/worker.js';
import type { MailProvider } from '../mail/provider.js';
import { assertSendable, domainOf } from '../mail/domain-verification.js';
import { renderNotification } from '../email/templates.js';
import { resolveTokens } from '../routes/brand-kit.js';

/**
 * Inviting signers by email (ROADMAP P1c-4b) — by the organisation's own mail, not Sign's.
 *
 * Sign decides whose turn it is (a party becomes `invited`); Forms, which already holds each
 * party's address and link and already has a mail provider with a test mode, sends the email.
 * Only when the sender asked for it (`inviteByEmail`, confirmed in the screen — rule 7), only to
 * a party with an address, and once per turn: `invitedByEmailAt` marks the party as queued, so a
 * second hook for the same step sends nothing. A reminder is a separate, deliberate press.
 *
 * The words are operational — who asks, which document, the link — never the declaration, which
 * the signer reads on Sign's page in words a person in the organisation wrote (rule 8).
 */
export const SIGNING_INVITE_JOB = 'signing.invite';

const COPY = {
  'en-GB': {
    subject: '{organisation} asks you to sign: {document}',
    heading: 'Please sign {document}',
    intro: '{organisation} has sent you a document to read and sign.',
    reminder: 'A reminder: {organisation} is still waiting for your signature.',
    document: 'Document',
    from: 'From',
    open: 'Open and sign',
    test: 'This is a test. Nothing signed from it is marked as real.',
    footer: 'If you were not expecting this, you can ignore it.',
  },
  'sv-SE': {
    subject: '{organisation} ber dig signera: {document}',
    heading: 'Signera {document}',
    intro: '{organisation} har skickat ett dokument som du ombeds läsa och signera.',
    reminder: 'En påminnelse: {organisation} väntar fortfarande på din underskrift.',
    document: 'Dokument',
    from: 'Från',
    open: 'Öppna och signera',
    test: 'Det här är ett test. Inget som signeras här markeras som skarpt.',
    footer: 'Om du inte väntade dig det här kan du bortse från det.',
  },
  'nb-NO': {
    subject: '{organisation} ber deg signere: {document}',
    heading: 'Signer {document}',
    intro: '{organisation} har sendt deg et dokument du blir bedt om å lese og signere.',
    reminder: 'En påminnelse: {organisation} venter fortsatt på signaturen din.',
    document: 'Dokument',
    from: 'Fra',
    open: 'Åpne og signer',
    test: 'Dette er en test. Ingenting som signeres her, markeres som ekte.',
    footer: 'Hvis du ikke ventet dette, kan du se bort fra det.',
  },
  'da-DK': {
    subject: '{organisation} beder dig underskrive: {document}',
    heading: 'Underskriv {document}',
    intro: '{organisation} har sendt dig et dokument, som du bedes læse og underskrive.',
    reminder: 'En påmindelse: {organisation} venter stadig på din underskrift.',
    document: 'Dokument',
    from: 'Fra',
    open: 'Åbn og underskriv',
    test: 'Dette er en test. Intet, der underskrives her, markeres som rigtigt.',
    footer: 'Hvis du ikke ventede dette, kan du se bort fra det.',
  },
  'fi-FI': {
    subject: '{organisation} pyytää sinua allekirjoittamaan: {document}',
    heading: 'Allekirjoita {document}',
    intro: '{organisation} on lähettänyt sinulle asiakirjan luettavaksi ja allekirjoitettavaksi.',
    reminder: 'Muistutus: {organisation} odottaa yhä allekirjoitustasi.',
    document: 'Asiakirja',
    from: 'Lähettäjä',
    open: 'Avaa ja allekirjoita',
    test: 'Tämä on testi. Mitään tästä allekirjoitettua ei merkitä todelliseksi.',
    footer: 'Jos et odottanut tätä, voit jättää sen huomiotta.',
  },
  'is-IS': {
    subject: '{organisation} biður þig að undirrita: {document}',
    heading: 'Undirritaðu {document}',
    intro: '{organisation} hefur sent þér skjal til að lesa og undirrita.',
    reminder: 'Áminning: {organisation} bíður enn eftir undirskrift þinni.',
    document: 'Skjal',
    from: 'Frá',
    open: 'Opna og undirrita',
    test: 'Þetta er próf. Ekkert sem er undirritað hér telst raunverulegt.',
    footer: 'Ef þú áttir ekki von á þessu geturðu hunsað það.',
  },
  'de-DE': {
    subject: '{organisation} bittet Sie um Ihre Unterschrift: {document}',
    heading: 'Bitte unterschreiben Sie {document}',
    intro: '{organisation} hat Ihnen ein Dokument zum Lesen und Unterschreiben geschickt.',
    reminder: 'Eine Erinnerung: {organisation} wartet noch auf Ihre Unterschrift.',
    document: 'Dokument',
    from: 'Von',
    open: 'Öffnen und unterschreiben',
    test: 'Dies ist ein Test. Nichts, was hier unterschrieben wird, gilt als echt.',
    footer: 'Wenn Sie dies nicht erwartet haben, können Sie es ignorieren.',
  },
  'fr-FR': {
    subject: '{organisation} vous demande de signer : {document}',
    heading: 'Veuillez signer {document}',
    intro: '{organisation} vous a envoyé un document à lire et à signer.',
    reminder: 'Un rappel : {organisation} attend toujours votre signature.',
    document: 'Document',
    from: 'De',
    open: 'Ouvrir et signer',
    test: "Ceci est un test. Rien de ce qui est signé ici n'est considéré comme réel.",
    footer: "Si vous ne vous attendiez pas à ce message, vous pouvez l'ignorer.",
  },
  'es-ES': {
    subject: '{organisation} te pide que firmes: {document}',
    heading: 'Firma {document}',
    intro: '{organisation} te ha enviado un documento para leer y firmar.',
    reminder: 'Un recordatorio: {organisation} sigue esperando tu firma.',
    document: 'Documento',
    from: 'De',
    open: 'Abrir y firmar',
    test: 'Esto es una prueba. Nada de lo que se firme aquí se considera real.',
    footer: 'Si no esperabas este mensaje, puedes ignorarlo.',
  },
  'ru-RU': {
    subject: '{organisation} просит вас подписать: {document}',
    heading: 'Подпишите {document}',
    intro: '{organisation} отправляет вам документ, чтобы вы прочитали и подписали его.',
    reminder: 'Напоминание: {organisation} всё ещё ждёт вашей подписи.',
    document: 'Документ',
    from: 'От',
    open: 'Открыть и подписать',
    test: 'Это тест. Ничто подписанное здесь не считается настоящим.',
    footer: 'Если вы не ожидали этого письма, просто не обращайте на него внимания.',
  },
  'ja-JP': {
    subject: '{organisation} から署名の依頼: {document}',
    heading: '{document} に署名してください',
    intro: '{organisation} から、確認と署名をお願いする文書が届いています。',
    reminder: 'リマインダー: {organisation} があなたの署名をお待ちしています。',
    document: '文書',
    from: '差出人',
    open: '開いて署名する',
    test: 'これはテストです。ここで署名したものは本番扱いになりません。',
    footer: 'お心当たりのない場合は、このメールを無視してください。',
  },
  'zh-CN': {
    subject: '{organisation} 请你签署：{document}',
    heading: '请签署 {document}',
    intro: '{organisation} 向你发送了一份需要阅读并签署的文件。',
    reminder: '提醒：{organisation} 仍在等待你的签名。',
    document: '文件',
    from: '发件方',
    open: '打开并签署',
    test: '这是测试。在此签署的内容不会被视为正式签署。',
    footer: '如果你没有预料到这封邮件，可以忽略它。',
  },
} as const;

export const INVITATION_COPY_LOCALES = Object.keys(COPY);

function copyFor(locale: string) {
  return COPY[locale as keyof typeof COPY] ?? COPY['en-GB'];
}

function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '');
}

/** Whose turn it is, has an address, and has not been emailed for it. */
export function dueForInvitation(record: SigningRequestRecord): SigningRequestParty[] {
  if (!record.inviteByEmail) return [];
  return record.parties.filter(
    (party) => party.email && party.status === 'invited' && !party.invitedByEmailAt,
  );
}

/**
 * Queues an email for each party due one, and marks them so a later hook does not queue again.
 * `reminder` names one party to email again whatever its mark says (a person pressed "remind").
 */
export async function queueInvitations(
  repos: Repositories,
  record: SigningRequestRecord,
  reminder?: string,
): Promise<SigningRequestRecord> {
  const due = reminder
    ? record.parties.filter(
        (p) => p.id === reminder && p.email && (p.status === 'invited' || p.status === 'viewed'),
      )
    : dueForInvitation(record);
  if (due.length === 0) return record;
  const at = new Date().toISOString();
  for (const party of due) {
    await repos.jobs.enqueue({
      organisationId: record.organisationId,
      kind: SIGNING_INVITE_JOB,
      // One per party per press: a retried job is the same key and cannot double-send.
      idempotencyKey: `${SIGNING_INVITE_JOB}:${record.id}:${party.id}:${at}`,
      payload: { signingRequestId: record.id, partyId: party.id, reminder: Boolean(reminder) },
      progressTotal: 1,
    });
  }
  const ids = new Set(due.map((p) => p.id));
  const parties = record.parties.map((party) =>
    ids.has(party.id) ? { ...party, invitedByEmailAt: at } : party,
  );
  return (
    (await repos.signingRequests.saveStatus(record.id, { status: record.status, parties })) ??
    record
  );
}

export function createSigningInviteHandler(deps: {
  repos: Repositories;
  provider: MailProvider;
}): JobHandler {
  return async ({ job }) => {
    const organisation = await deps.repos.organisations.findById(job.organisationId);
    if (!organisation) throw new Error('organisation missing');
    const record = await deps.repos.signingRequests.findById(
      job.organisationId,
      String(job.payload['signingRequestId'] ?? ''),
    );
    if (!record) throw new Error('signing request missing');
    const party = record.parties.find((p) => p.id === job.payload['partyId']);
    if (!party?.email) return { skipped: 'no address' };
    // Signed or declined since it was queued: an invitation now would be wrong.
    if (party.status !== 'invited' && party.status !== 'viewed') {
      return { skipped: `party is ${party.status}` };
    }

    const sendingDomain = (await deps.repos.sendingDomains.list(job.organisationId))[0] ?? null;
    const from = sendingDomain?.fromAddress ?? '';
    // The same rule every email from this product keeps (`send-job.ts`).
    if (
      !['console', 'memory', 'outbox', 'queue', 'outlook', 'apple-mail'].includes(
        deps.provider.name,
      )
    ) {
      assertSendable(
        sendingDomain
          ? {
              domain: sendingDomain.domain,
              verified: sendingDomain.verified,
              checks: [],
              checkedAt: sendingDomain.lastCheckedAt?.toISOString() ?? '',
            }
          : null,
        sendingDomain?.domain ?? (domainOf(from) || 'unknown'),
      );
    }

    const copy = copyFor(party.locale);
    const values = { organisation: organisation.name, document: record.documentName };
    const intro = fill(job.payload['reminder'] ? copy.reminder : copy.intro, values);
    const testNote = record.environment === 'test' ? copy.test : '';
    const { tokens } = await resolveTokens(deps.repos, job.organisationId);
    const html = await renderNotification(tokens, {
      lang: party.locale,
      heading: fill(copy.heading, values),
      intro: testNote ? `${intro} ${testNote}` : intro,
      rows: [
        { label: copy.document, value: record.documentName },
        { label: copy.from, value: organisation.name },
      ],
      linkLabel: copy.open,
      linkUrl: party.signUrl,
      footer: `${organisation.name} · ${copy.footer}`,
    });
    const subject = fill(copy.subject, values);
    const sent = await deps.provider.send({
      to: party.email,
      from: from || undefined,
      subject,
      text: [intro, testNote, `${copy.open}: ${party.signUrl}`, copy.footer]
        .filter(Boolean)
        .join('\n\n'),
      html,
      idempotencyKey: job.idempotencyKey,
    });
    return { messageId: sent.messageId };
  };
}
