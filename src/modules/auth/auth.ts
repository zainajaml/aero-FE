import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { jwt } from "better-auth/plugins";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { mcp } from "@better-auth/mcp";
import { env } from "../../config/env.js";
import { db } from "../../database/client.js";
import {
  authAccounts,
  jwks,
  oauthAccessTokens,
  oauthClientAssertions,
  oauthClientResources,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
  oauthResources,
  sessions,
  users,
  verifications,
} from "../../database/schema/index.js";
import { findActor, isUserArchived } from "../access/access.repository.js";
import { isSuperAdmin } from "../access/access.policy.js";
import { MCP_RESOURCE, OAUTH_CONSENT_PAGE, OAUTH_LOGIN_PAGE } from "../mcp/mcp.config.js";
import { SITE_NAME, sendTemplateEmail } from "../notifications/email.service.js";
import { onEmailVerified, onUserCreated } from "./registration.service.js";

const SESSION_DAYS = 7;

/** OAuth client and resource administration (create/list/update/delete) is super-admin only. */
async function superAdminOnly({ user }: { user?: { id: string } }): Promise<boolean> {
  if (!user) return false;
  const actor = await findActor(db, user.id);
  return actor !== null && isSuperAdmin(actor);
}

export const auth = betterAuth({
  appName: SITE_NAME,
  baseURL: env.API_URL,
  basePath: "/api/auth",
  secret: env.AUTH_SECRET,
  trustedOrigins: [env.APP_URL, ...env.CORS_ORIGINS],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: users,
      session: sessions,
      account: authAccounts,
      verification: verifications,
      jwks,
      oauthClient: oauthClients,
      oauthResource: oauthResources,
      oauthClientResource: oauthClientResources,
      oauthRefreshToken: oauthRefreshTokens,
      oauthAccessToken: oauthAccessTokens,
      oauthConsent: oauthConsents,
      oauthClientAssertion: oauthClientAssertions,
    },
  }),
  // The JWT plugin's session-token endpoint is not needed: only the OAuth provider signs tokens.
  disabledPaths: ["/token"],
  advanced: {
    database: { generateId: "uuid" },
    cookiePrefix: "azf",
    useSecureCookies: env.NODE_ENV === "production",
    ipAddress: { ipAddressHeaders: env.TRUST_PROXY > 0 ? ["x-forwarded-for"] : [] },
  },
  // Abuse limits are enforced by our durable, shared limiter in auth.routes.ts.
  rateLimit: { enabled: false },
  session: {
    expiresIn: SESSION_DAYS * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      await sendTemplateEmail({
        template: "password-reset",
        to: user.email,
        data: { siteName: SITE_NAME, confirmationUrl: url },
        skipRecipientLimit: true,
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 24 * 60 * 60,
    sendVerificationEmail: async ({ user, url }) => {
      await sendTemplateEmail({
        template: "verify-email",
        to: user.email,
        data: {
          siteName: SITE_NAME,
          siteUrl: env.APP_URL,
          recipient: user.email,
          confirmationUrl: url,
        },
        skipRecipientLimit: true,
      });
    },
    afterEmailVerification: async (user) => {
      await onEmailVerified({ id: user.id, email: user.email });
    },
  },
  socialProviders:
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            prompt: "select_account",
          },
        }
      : {},
  account: {
    accountLinking: { enabled: true, trustedProviders: ["google"] },
  },
  user: {
    changeEmail: { enabled: false },
    deleteUser: { enabled: false },
  },
  plugins: [
    // Signs MCP access tokens; keys live in `jwks`, private keys encrypted with AUTH_SECRET.
    jwt({ disableSettingJwtHeader: true }),
    // OAuth 2.1 authorization server for MCP clients; tokens are audience-bound to MCP_RESOURCE.
    mcp({
      resource: MCP_RESOURCE,
      loginPage: OAUTH_LOGIN_PAGE,
      consentPage: OAUTH_CONSENT_PAGE,
      // Only user-delegated grants: every MCP call must run as a real user.
      grantTypes: ["authorization_code", "refresh_token"],
      // MCP clients (Claude and others) register themselves (RFC 7591). Open registration is
      // limited by the durable per-IP limiter in app.ts; clients cannot use client_credentials,
      // PKCE stays required, and every token still needs a signed-in user's consent.
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      // Lets the login page name the requesting client before sign-in (signed oauth_query only).
      allowPublicClientPrelogin: true,
      clientPrivileges: superAdminOnly,
      resourcePrivileges: superAdminOnly,
    }),
  ],
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await onUserCreated({
            id: user.id,
            email: user.email,
            name: user.name,
            image: user.image ?? null,
            emailVerified: user.emailVerified,
          });
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          // Archived identities keep their history but can no longer sign in.
          if (await isUserArchived(db, session.userId)) {
            throw new APIError("FORBIDDEN", {
              code: "ACCOUNT_ARCHIVED",
              message: "This account has been archived and can no longer sign in.",
            });
          }
        },
      },
    },
  },
});
