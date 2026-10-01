import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./_shared.js";

/** Better Auth JWT plugin signing keys (model "jwks"); private keys are encrypted with AUTH_SECRET. */
export const jwks = pgTable("jwks", {
  id: uuid("id").primaryKey().defaultRandom(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  alg: text("alg"),
  crv: text("crv"),
  createdAt: createdAt(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});
