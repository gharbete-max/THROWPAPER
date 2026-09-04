import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { resolveTokens } from './brand-kit.js';
import type { Repositories } from '../db/repositories/index.js';
import { renderInvoiceDocument } from '../documents/invoice.js';
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

export function registerPublicInvoiceRoutes(app: FastifyInstance, deps: { repos: Repositories }) {
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

      const invoice = await deps.repos.invoices.findByPublicToken(token);

      /*
       * The same answer for a token that never existed and one belonging to another organisation.
       *
       * There is nothing to distinguish and nothing gained by distinguishing it: either way the
       * person holding this link has no invoice to read.
       */
      if (!invoice) {
        return reply.code(404).type('text/html; charset=utf-8').send(NOT_FOUND);
      }

      const organisation = await deps.repos.organisations.findById(invoice.organisationId);
      if (!organisation) {
        return reply.code(404).type('text/html; charset=utf-8').send(NOT_FOUND);
      }

      const locales = {
        supported: organisation.supportedLocales,
        default: organisation.defaultLocale,
      };
      const locale =
        lang && organisation.supportedLocales.includes(lang) ? lang : organisation.defaultLocale;

      /* The organisation's own palette, so their tenant sees their brand and not ours. */
      const { tokens } = await resolveTokens(deps.repos, invoice.organisationId);

      const html = renderInvoiceDocument({
        invoice,
        organisationName: organisation.name,
        locale,
        locales,
        strings: invoiceCopy(locale, organisation.defaultLocale),
        tokens,
        media: 'web',
      });

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
