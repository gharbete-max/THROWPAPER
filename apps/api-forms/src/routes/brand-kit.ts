import type { FastifyInstance } from 'fastify';
import { api, brand } from '@tp/shared';
import { checkContrast, defaultTokens, type TokenSet } from '@tp/tokens';
import type { AuthGuardDeps } from '../auth/plugin.js';
import { requireAuth } from '../auth/plugin.js';
import type { Repositories } from '../db/repositories/index.js';
import { recordAudit } from '../audit.js';

const errorResponses = {
  401: api.ErrorResponse,
  403: api.ErrorResponse,
  422: api.ErrorResponse,
} as const;

/**
 * The organisation's brand kit, or the shipped defaults when it has not chosen one.
 *
 * Absence is the default rather than a copy of it: storing the defaults at sign-up would freeze
 * them, and an organisation that never touched its brand would be stuck on whatever the product
 * looked like the day it was created.
 */
export async function resolveTokens(
  repos: Repositories,
  organisationId: string,
): Promise<{ tokens: TokenSet; customised: boolean; updatedAt: Date | null }> {
  const kit = await repos.brandKits.find(organisationId);
  if (!kit) return { tokens: defaultTokens, customised: false, updatedAt: null };

  /**
   * Parsed on the way out, not trusted. The row is JSON written by an older version of this
   * schema, and a token missing from an old document would otherwise reach a compiler as
   * `undefined` and be interpolated into CSS as the string "undefined".
   */
  const parsed = brand.BrandKit.safeParse(kit.tokens);
  if (!parsed.success)
    return { tokens: defaultTokens, customised: false, updatedAt: kit.updatedAt };

  return { tokens: parsed.data as TokenSet, customised: true, updatedAt: kit.updatedAt };
}

export function registerBrandKitRoutes(
  app: FastifyInstance,
  deps: { repos: Repositories; guard: AuthGuardDeps },
): void {
  const adminOnly = requireAuth(deps.guard, ['admin']);
  const anySignedIn = requireAuth(deps.guard, ['admin', 'operator']);

  /** Everyone signed in reads it — the app paints itself with it. Only admins may change it. */
  app.get('/v1/brand-kit', {
    preHandler: anySignedIn,
    schema: {
      tags: ['brand'],
      response: { 200: brand.BrandKitResponse, ...errorResponses },
    },
    handler: async (request) => {
      const { tokens, customised, updatedAt } = await resolveTokens(
        deps.repos,
        request.auth!.organisation.id,
      );
      return {
        tokens,
        customised,
        updatedAt: updatedAt?.toISOString() ?? null,
        warnings: checkContrast(tokens),
      };
    },
  });

  app.put('/v1/brand-kit', {
    preHandler: adminOnly,
    schema: {
      tags: ['brand'],
      body: brand.BrandKit,
      response: { 200: brand.BrandKitResponse, ...errorResponses },
    },
    handler: async (request) => {
      const organisationId = request.auth!.organisation.id;
      const before = await resolveTokens(deps.repos, organisationId);
      const tokens = brand.BrandKit.parse(request.body);

      const saved = await deps.repos.brandKits.save({
        organisationId,
        tokens,
        updatedBy: request.auth!.user.id,
      });

      await recordAudit(deps.repos, request, {
        action: 'brand-kit.update',
        entityType: 'brand_kit',
        entityId: organisationId,
        before: before.customised ? before.tokens : null,
        after: tokens,
      });

      /**
       * Contrast is returned, never enforced. An unreadable choice is worth saying out loud while
       * somebody is making it; refusing to store their brand over it would be the tool telling the
       * customer they are wrong about their own colours.
       */
      return {
        tokens,
        customised: true,
        updatedAt: saved.updatedAt.toISOString(),
        warnings: checkContrast(tokens as TokenSet),
      };
    },
  });

  /** Back to the shipped defaults. Deletes the row rather than storing a copy of them. */
  app.delete('/v1/brand-kit', {
    preHandler: adminOnly,
    schema: {
      tags: ['brand'],
      response: { 200: brand.BrandKitResponse, ...errorResponses },
    },
    handler: async (request) => {
      const organisationId = request.auth!.organisation.id;
      const before = await resolveTokens(deps.repos, organisationId);
      await deps.repos.brandKits.clear(organisationId);

      await recordAudit(deps.repos, request, {
        action: 'brand-kit.reset',
        entityType: 'brand_kit',
        entityId: organisationId,
        before: before.customised ? before.tokens : null,
        after: null,
      });

      return {
        tokens: defaultTokens,
        customised: false,
        updatedAt: null,
        warnings: checkContrast(defaultTokens),
      };
    },
  });
}
