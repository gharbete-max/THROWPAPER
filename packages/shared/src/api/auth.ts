import { z } from 'zod';
import { Email, Locale, Role, Uuid } from './common.js';

export const RequestMagicLink = z.object({
  email: Email,
  /** Where to send the user after the link is exchanged. Relative paths only. */
  redirectTo: z.string().startsWith('/').max(512).optional(),
});

/**
 * Always 202, whatever the address. Telling a caller whether an account exists is an
 * enumeration oracle.
 */
export const RequestMagicLinkResponse = z.object({ status: z.literal('sent') });

export const ExchangeToken = z.object({ token: z.string().min(16).max(512) });
export const RefreshRequest = z.object({ refreshToken: z.string().min(16).max(512) });
export const LogoutRequest = RefreshRequest;

export const SessionUser = z.object({
  id: Uuid,
  email: Email,
  name: z.string(),
  role: Role,
});

export const OrganisationSummary = z.object({
  id: Uuid,
  name: z.string(),
  slug: z.string(),
  defaultLocale: Locale,
  supportedLocales: z.array(Locale),
});

export const TokenPair = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  /** Seconds until the access token expires. */
  expiresIn: z.number().int().positive(),
  user: SessionUser,
  organisation: OrganisationSummary,
});

export const MeResponse = z.object({
  user: SessionUser,
  organisation: OrganisationSummary,
});

export type TokenPair = z.infer<typeof TokenPair>;
export type SessionUser = z.infer<typeof SessionUser>;
export type OrganisationSummary = z.infer<typeof OrganisationSummary>;
export type MeResponse = z.infer<typeof MeResponse>;
