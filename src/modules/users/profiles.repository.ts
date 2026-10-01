import { eq } from "drizzle-orm";
import type { DbExecutor } from "../../database/client.js";
import { profiles } from "../../database/schema/index.js";

export type NewProfile = {
  id: string;
  email: string;
  fullName: string | null;
  firstName?: string | null;
  lastName?: string | null;
  avatarUrl?: string | null;
};

/** Idempotent: the profile row is created exactly once per identity. */
export async function ensureProfile(db: DbExecutor, profile: NewProfile): Promise<void> {
  await db.insert(profiles).values(profile).onConflictDoNothing({ target: profiles.id });
}

export async function findProfile(db: DbExecutor, userId: string) {
  const [row] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
  return row ?? null;
}

export async function updateProfile(
  db: DbExecutor,
  userId: string,
  patch: Partial<typeof profiles.$inferInsert>,
): Promise<void> {
  await db.update(profiles).set(patch).where(eq(profiles.id, userId));
}

export async function profileName(db: DbExecutor, userId: string) {
  const [row] = await db
    .select({
      fullName: profiles.fullName,
      firstName: profiles.firstName,
      lastName: profiles.lastName,
    })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  return row ?? null;
}
