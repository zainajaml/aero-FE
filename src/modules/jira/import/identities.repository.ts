import { eq, sql } from "drizzle-orm";
import type { DbExecutor } from "../../../database/client.js";
import { profiles, users } from "../../../database/schema/index.js";
import { splitFullName } from "../../users/names.js";
import { ensureProfile, updateProfile } from "../../users/profiles.repository.js";

export async function profileIdByEmail(db: DbExecutor, email: string): Promise<string | null> {
  const [row] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(sql`lower(${profiles.email}) = lower(${email})`)
    .limit(1);
  if (row) return row.id;
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1);
  return user?.id ?? null;
}

/** Profiles whose full name equals `name` ignoring case (at most two, to detect ambiguity). */
export async function profileIdsByName(db: DbExecutor, name: string): Promise<string[]> {
  const rows = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(sql`lower(${profiles.fullName}) = lower(${name})`)
    .limit(2);
  return rows.map((r) => r.id);
}

/**
 * A not-yet-invited identity (unverified, no credentials, profile marked provisional) so imported
 * tickets, comments and time logs stay attributed. Returns the existing identity when the email
 * is already registered.
 */
export async function createProvisionalUser(
  db: DbExecutor,
  email: string,
  fullName: string,
): Promise<string> {
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(users)
      .values({ email, name: fullName, emailVerified: false })
      .onConflictDoNothing({ target: users.email })
      .returning({ id: users.id });
    if (!created) {
      const [existing] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email));
      return existing!.id;
    }
    await ensureProfile(tx, { id: created.id, email, fullName, ...splitFullName(fullName) });
    await updateProfile(tx, created.id, { isProvisional: true });
    return created.id;
  });
}
