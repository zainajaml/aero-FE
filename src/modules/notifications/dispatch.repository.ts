import { and, eq, inArray } from "drizzle-orm";
import type { DbExecutor } from "../../database/client.js";
import { profiles, projectMembers, userRoles, users } from "../../database/schema/index.js";

/** Of `userIds`, those who are members of the project or super admins (source notify rule). */
export async function withProjectAccess(
  db: DbExecutor,
  projectId: string,
  userIds: string[],
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const [members, supers] = await Promise.all([
    db
      .select({ userId: projectMembers.userId })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), inArray(projectMembers.userId, userIds))),
    db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(and(inArray(userRoles.userId, userIds), eq(userRoles.role, "super_admin"))),
  ]);
  return [...new Set([...members, ...supers].map((row) => row.userId))];
}

export async function recipients(db: DbExecutor, userIds: string[]) {
  if (userIds.length === 0) return [];
  return db
    .select({
      id: users.id,
      email: users.email,
      fullName: profiles.fullName,
      firstName: profiles.firstName,
      lastName: profiles.lastName,
    })
    .from(users)
    .innerJoin(profiles, eq(profiles.id, users.id))
    .where(inArray(users.id, userIds));
}
