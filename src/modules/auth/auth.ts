import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { env } from "../../config/env.js";
import { db } from "../../database/client.js";
import { authAccounts, sessions, users, verifications } from "../../database/schema/index.js";
import { isUserArchived } from "../access/access.repository.js";
import { SITE_NAME, sendTemplateEmail } from "../notifications/email.service.js";
import { onEmailVerified, onUserCreated } from "./registration.service.js";

const SESSION_DAYS = 7;

export const auth = betterAuth({
  appName: SITE_NAME,
  baseURL: env.API_URL,
  basePath: "/api/auth",
  secret: env.AUTH_SECRET,
  trustedOrigins: [env.APP_URL, ...env.CORS_ORIGINS],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user: users, session: sessions, account: authAccounts, verification: verifications },
  }),
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

export type AuthSession = typeof auth.$Infer.Session;
