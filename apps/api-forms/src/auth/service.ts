import type { Repositories, UserRecord, OrganisationRecord } from '../db/repositories/index.js';
import type { MailTransport } from './mail.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  MAGIC_LINK_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  expiryFrom,
  generateSecret,
  hashSecret,
  newFamilyId,
  signAccessToken,
} from './tokens.js';

export interface AuthConfig {
  jwtSecret: string;
  /** Base URL of apps/forms, used to build the magic link. */
  appUrl: string;
}

export interface AuthDeps {
  repos: Repositories;
  mail: MailTransport;
  config: AuthConfig;
  now?: () => Date;
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: UserRecord;
  organisation: OrganisationRecord;
}

export type ExchangeFailure = 'invalid' | 'expired' | 'used' | 'unknown-user';
export type RefreshFailure = 'invalid' | 'expired' | 'revoked' | 'reused' | 'unknown-user';

export function createAuthService({ repos, mail, config, now = () => new Date() }: AuthDeps) {
  async function issue(
    user: UserRecord,
    organisation: OrganisationRecord,
    options: { familyId?: string; rotatedFrom?: string | null; userAgent?: string | null } = {},
  ): Promise<IssuedSession> {
    const at = now();
    const refreshSecret = generateSecret();
    await repos.tokens.createRefreshToken({
      userId: user.id,
      familyId: options.familyId ?? newFamilyId(),
      tokenHash: hashSecret(refreshSecret),
      rotatedFrom: options.rotatedFrom ?? null,
      userAgent: options.userAgent ?? null,
      expiresAt: expiryFrom(at, REFRESH_TOKEN_TTL_SECONDS),
    });

    return {
      accessToken: await signAccessToken(
        { userId: user.id, organisationId: user.organisationId, role: user.role },
        config.jwtSecret,
        at,
      ),
      refreshToken: refreshSecret,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      user,
      organisation,
    };
  }

  return {
    /**
     * Always resolves, whether or not the address belongs to a user. Reporting "no such account"
     * would turn this endpoint into an account-enumeration oracle.
     */
    async requestMagicLink(input: {
      email: string;
      redirectTo?: string;
      ip?: string | null;
    }): Promise<void> {
      const organisation = await repos.organisations.first();
      if (!organisation) return;

      const user = await repos.users.findByEmail(organisation.id, input.email);
      if (!user || user.disabledAt) return;

      const secret = generateSecret();
      await repos.tokens.createLoginToken({
        userId: user.id,
        tokenHash: hashSecret(secret),
        redirectTo: input.redirectTo ?? null,
        expiresAt: expiryFrom(now(), MAGIC_LINK_TTL_SECONDS),
        requestedIp: input.ip ?? null,
      });

      const link = `${config.appUrl.replace(/\/$/, '')}/auth/callback?token=${secret}`;
      await mail.send({
        to: user.email,
        subject: 'Din inloggningslänk / Your sign-in link',
        text: `${link}\n\nLänken gäller i 15 minuter och kan bara användas en gång.`,
      });
    },

    /** Single use: the token is consumed atomically, so a replayed link fails. */
    async exchange(
      token: string,
      userAgent?: string | null,
    ): Promise<{ ok: true; session: IssuedSession } | { ok: false; reason: ExchangeFailure }> {
      const record = await repos.tokens.findLoginTokenByHash(hashSecret(token));
      if (!record) return { ok: false, reason: 'invalid' };
      if (record.consumedAt) return { ok: false, reason: 'used' };
      if (record.expiresAt.getTime() <= now().getTime()) return { ok: false, reason: 'expired' };

      if (!(await repos.tokens.consumeLoginToken(record.id, now()))) {
        return { ok: false, reason: 'used' };
      }

      const user = await repos.users.findById(record.userId);
      if (!user || user.disabledAt) return { ok: false, reason: 'unknown-user' };
      const organisation = await repos.organisations.findById(user.organisationId);
      if (!organisation) return { ok: false, reason: 'unknown-user' };

      return { ok: true, session: await issue(user, organisation, { userAgent }) };
    },

    /**
     * Rotates on every use. A token that has already been rotated or revoked means the chain
     * leaked, so the whole family is killed rather than just that one token.
     */
    async refresh(
      token: string,
      userAgent?: string | null,
    ): Promise<{ ok: true; session: IssuedSession } | { ok: false; reason: RefreshFailure }> {
      const record = await repos.tokens.findRefreshTokenByHash(hashSecret(token));
      if (!record) return { ok: false, reason: 'invalid' };

      if (record.revokedAt) {
        await repos.tokens.revokeFamily(record.familyId, now());
        return { ok: false, reason: 'reused' };
      }
      if (record.expiresAt.getTime() <= now().getTime()) {
        await repos.tokens.revokeRefreshToken(record.id, now());
        return { ok: false, reason: 'expired' };
      }

      const user = await repos.users.findById(record.userId);
      if (!user || user.disabledAt) return { ok: false, reason: 'unknown-user' };
      const organisation = await repos.organisations.findById(user.organisationId);
      if (!organisation) return { ok: false, reason: 'unknown-user' };

      await repos.tokens.revokeRefreshToken(record.id, now());
      return {
        ok: true,
        session: await issue(user, organisation, {
          familyId: record.familyId,
          rotatedFrom: record.id,
          userAgent,
        }),
      };
    },

    async logout(token: string): Promise<void> {
      const record = await repos.tokens.findRefreshTokenByHash(hashSecret(token));
      if (record) await repos.tokens.revokeRefreshToken(record.id, now());
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
