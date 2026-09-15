import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { MailProvider } from '../auth/mail.js';

/**
 * The "get in touch" form on the marketing site.
 *
 * ## Why it is a plain HTML form and a redirect
 *
 * The site ships no JavaScript — `main.tsx` never hydrates it in production — so the form posts
 * the way a form posted in 1998: `application/x-www-form-urlencoded`, and the answer is a 303 to
 * a page that says thank you. The three-line content-type parser below is the whole cost of that;
 * a body-parsing dependency would be a package for what the platform already has.
 *
 * ## Where it goes
 *
 * To `CONTACT_TO`, which is *our* inbox — not `MAIL_OPERATOR`, which is a customer's organiser.
 * Unset, the route answers 503 and says so, rather than swallowing a message somebody took the
 * time to write. `deploy.md` lists the variable.
 *
 * ## The guards a public write needs
 *
 * The same two the public form has: a rate limit and a honeypot. `website` is a field no person
 * sees (`.visually-hidden` on the site) and a bot fills; a non-empty value is answered with the
 * same redirect as success, so a scraper learns nothing from the difference.
 */
const ContactRequest = z.object({
  name: z.string().trim().min(1).max(120),
  organisation: z.string().trim().max(120).optional().default(''),
  email: z.string().trim().email().max(254),
  message: z.string().trim().min(1).max(4000),
  /**
   * Where to send them afterwards: the thank-you page in their own language, written by the site
   * into a hidden field. Held to that one shape so it can never be an open redirect.
   */
  next: z
    .string()
    .regex(/^\/(?:[a-z]{2}\/)?contact\/sent$/)
    .default('/contact/sent'),
  website: z.string().optional().default(''),
});

export function registerPublicContactRoutes(
  app: FastifyInstance,
  deps: { mail: MailProvider; contactAddress: string | null },
): void {
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))),
  );

  app.post('/public/contact', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: { tags: ['public'], body: ContactRequest },
    handler: async (request, reply) => {
      const body = ContactRequest.parse(request.body);
      if (body.website.trim() !== '') return reply.code(303).redirect(body.next);

      if (!deps.contactAddress) {
        request.log.warn('CONTACT_TO is not set; a contact message was refused');
        return reply
          .code(503)
          .send({ error: { code: 'contact-unconfigured', message: 'Contact is not configured' } });
      }

      await deps.mail.send({
        to: deps.contactAddress,
        subject: `Loppa: ${body.name}${body.organisation ? ` (${body.organisation})` : ''}`,
        text: `${body.name} <${body.email}>${body.organisation ? `\n${body.organisation}` : ''}\n\n${body.message}\n`,
      });

      return reply.code(303).redirect(body.next);
    },
  });
}
