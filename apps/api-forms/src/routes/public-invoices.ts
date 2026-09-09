import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { resolveTokens } from './brand-kit.js';
import type { Repositories } from '../db/repositories/index.js';
import type { PdfRenderer } from '../documents/render.js';
import { renderInvoiceDocument, type InvoiceMedia } from '../documents/invoice.js';
import { invoiceCopy } from '../documents/invoice-copy.js';

/**
 * The invoice a tenant opens from a link in an email.
 *
 * **No bearer token.** The reader has no account and never will: they are a tenant, a member, a
 * customer. The long random token in the URL is what stands in for a session, which is why it is
 * long, random, and deliberately not the payment reference — an OCR is printed on the invoice and
 * quoted on every bank statement, so using it here would let everybody who handles the payment read
 * the invoice behind it.
 *
 * It answers HTML rather than JSON. There is no client to hand JSON to: the page is a document, it
 * is read once, and it should arrive finished on a phone with a poor connection.
 */

const TokenParam = z.object({
  /* Fixed alphabet and length: anything else cannot be a token this app issued. */
  token: z.string().regex(/^[a-f0-9]{32,64}$/),
});

const Query = z.object({
  /** The reader's own language, when they have said. Otherwise the invoice's own. */
  lang: z.string().max(16).optional(),
});

export function registerPublicInvoiceRoutes(
  app: FastifyInstance,
  deps: { repos: Repositories; renderer: PdfRenderer },
) {
  /**
   * Everything both routes need before they can render anything.
   *
   * The page and the file are the same document — same invoice, same organisation, same palette,
   * same language rule. Loading it twice is how the two drift into disagreeing about which
   * language a tenant asked for, which is the one difference nobody would notice until a PDF
   * arrived in the wrong one.
   */
  async function load(token: string, lang: string | undefined) {
    const invoice = await deps.repos.invoices.findByPublicToken(token);
    if (!invoice) return null;

    const organisation = await deps.repos.organisations.findById(invoice.organisationId);
    if (!organisation) return null;

    const locale =
      lang && organisation.supportedLocales.includes(lang) ? lang : organisation.defaultLocale;

    /* The organisation's own palette, so their tenant sees their brand and not ours. */
    const { tokens } = await resolveTokens(deps.repos, invoice.organisationId);

    return {
      invoice,
      html: (media: InvoiceMedia, pdfUrl?: string) =>
        renderInvoiceDocument({
          invoice,
          organisationName: organisation.name,
          locale,
          locales: {
            supported: organisation.supportedLocales,
            default: organisation.defaultLocale,
          },
          strings: invoiceCopy(locale, organisation.defaultLocale),
          tokens,
          media,
          pdfUrl,
        }),
    };
  }

  app.get(
    '/i/:token',
    {
      schema: { params: TokenParam, querystring: Query },
      /*
       * Rate limited like every other public route.
       *
       * The token is long enough that guessing is not a real threat, but a limit turns "not
       * realistic" into "not possible" and costs nothing.
       */
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { token } = request.params as z.infer<typeof TokenParam>;
      const { lang } = request.query as z.infer<typeof Query>;

      /*
       * The same answer for a token that never existed and one belonging to another organisation.
       *
       * There is nothing to distinguish and nothing gained by distinguishing it: either way the
       * person holding this link has no invoice to read.
       */
      const loaded = await load(token, lang);
      if (!loaded) {
        return reply.code(404).type('text/html; charset=utf-8').send(NOT_FOUND);
      }

      /* The reader's language travels with them to the file, or the PDF arrives in another one. */
      const pdfUrl = lang ? `/i/${token}/pdf?lang=${encodeURIComponent(lang)}` : `/i/${token}/pdf`;
      const html = loaded.html('web', pdfUrl);

      return (
        reply
          .type('text/html; charset=utf-8')
          /*
           * Never cached by anything in between.
           *
           * An invoice is somebody's name, address and what they owe. A proxy holding a copy of it is
           * a copy nobody agreed to, and a shared computer showing the last tenant's invoice from the
           * back button is worse.
           */
          .header('cache-control', 'no-store, private')
          /* Not indexed: these URLs are private links, not pages. */
          .header('x-robots-tag', 'noindex, nofollow')
          .send(html)
      );
    },
  );

  /**
   * The same invoice as a file.
   *
   * Not a second document: the same `renderInvoiceDocument`, asked for `print` instead of `web`,
   * through the Chromium the admission cards already use. An invoice that can only be read in a
   * browser tab is one a tenant cannot forward to whoever pays it or file with their accounts,
   * and "print this page" gives them the browser's own headers and footers across somebody's
   * bank details.
   *
   * `/i/:token/pdf` rather than `/i/:token.pdf`: the token pattern is a fixed alphabet, and a
   * route where the extension has to be peeled off the parameter before it can be validated is a
   * route with two ways to read the same string.
   */
  app.get(
    '/i/:token/pdf',
    {
      schema: { params: TokenParam, querystring: Query },
      /*
       * Tighter than the page it comes from. Rendering one is about a second of Chromium, so the
       * limit here is about what this endpoint costs to serve rather than about guessing tokens.
       */
      config: { rateLimit: { max: 12, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { token } = request.params as z.infer<typeof TokenParam>;
      const { lang } = request.query as z.infer<typeof Query>;

      const loaded = await load(token, lang);
      if (!loaded) {
        return reply.code(404).type('text/html; charset=utf-8').send(NOT_FOUND);
      }

      const pdf = await deps.renderer.render(loaded.html('print'));

      return (
        reply
          .header('content-type', 'application/pdf')
          /*
           * Named for the invoice, not for the token.
           *
           * The token is the reader's credential; it should not end up as a filename in a
           * downloads folder, in a backup, or read out over the phone to whoever asks for the
           * invoice again. The number is the thing both sides already call it.
           */
          .header('content-disposition', `attachment; filename="${loaded.invoice.number}.pdf"`)
          /* Same reasoning as the page: somebody's name, address and what they owe. */
          .header('cache-control', 'no-store, private')
          .header('x-robots-tag', 'noindex, nofollow')
          .send(pdf)
      );
    },
  );
}

/**
 * What a stale or mistyped link gets.
 *
 * Deliberately says nothing about why. "That invoice belongs to another organisation" tells
 * somebody holding a guessed token that they guessed close, and a tenant with an old link is
 * helped by neither sentence.
 */
const NOT_FOUND = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Invoice not found</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0; display: grid; place-items: center;
         min-height: 100vh; padding: 24px; color: #171a20; background: #faf7f0; }
  main { max-width: 28rem; text-align: center; }
</style></head>
<body><main>
  <h1>This link no longer works</h1>
  <p>The invoice may have been withdrawn, or the link may have been copied incompletely.
     Whoever sent it can send it again.</p>
</main></body>
</html>`;
