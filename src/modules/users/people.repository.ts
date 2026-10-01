import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { DbExecutor } from "../../database/client.js";
import {
  accountAdmins,
  profiles,
  projectMembers,
  projects,
  userRoles,
} from "../../database/schema/index.js";

/** SQL predicate: `viewerId` shares a project or account with the profile row (ports shares_project). */
function sharesProjectWith(viewerId: string): SQL {
  return sql`(
    exists (select 1 from ${projectMembers} pm1 join ${projectMembers} pm2 on pm1.project_id = pm2.project_id
            where pm1.user_id = ${viewerId} and pm2.user_id = ${profiles.id})
    or exists (select 1 from ${accountAdmins} aa join ${projects} p on p.account_id = aa.account_id
               join ${projectMembers} pm on pm.project_id = p.id
               where (aa.user_id = ${viewerId} and pm.user_id = ${profiles.id})
                  or (aa.user_id = ${profiles.id} and pm.user_id = ${viewerId}))
    or exists (select 1 from ${accountAdmins} a1 join ${accountAdmins} a2 on a1.account_id = a2.account_id
               where a1.user_id = ${viewerId} and a2.user_id = ${profiles.id})
  )`;
}

const personColumns = {
  id: profiles.id,
  fullName: profiles.fullName,
  firstName: profiles.firstName,
  lastName: profiles.lastName,
  avatarUrl: profiles.avatarUrl,
  jobTitle: profiles.jobTitle,
};

/** Profiles among `ids` the viewer may see: self, anyone for super admins, else shared membership. */
export async function listVisibleProfiles(
  db: DbExecutor,
  viewerId: string,
  isSuperAdmin: boolean,
  ids: string[],
) {
  if (ids.length === 0) return [];
  const visibility = isSuperAdmin
    ? sql`true`
    : sql`(${profiles.id} = ${viewerId} or ${sharesProjectWith(viewerId)})`;
  return db
    .select(personColumns)
    .from(profiles)
    .where(and(inArray(profiles.id, ids), visibility));
}

/** Project members plus admins of the project's account; excludes archived users and super admins. */
export async function listProjectAccessibleUsers(db: DbExecutor, projectId: string) {
  const members = db
    .select({
      userId: projectMembers.userId,
      role: sql<string>`${projectMembers.role}::text`.as("role"),
    })
    .from(projectMembers)
    .where(eq(projectMembers.projectId, projectId));
  const accountAdminsOfProject = db
    .select({ userId: accountAdmins.userId, role: sql<string>`'account_admin'`.as("role") })
    .from(accountAdmins)
    .innerJoin(projects, eq(projects.accountId, accountAdmins.accountId))
    .where(eq(projects.id, projectId));
  const accessible = members.union(accountAdminsOfProject).as("accessible");
  return db
    .select({ userId: accessible.userId, role: accessible.role, ...personColumns })
    .from(accessible)
    .innerJoin(profiles, eq(profiles.id, accessible.userId))
    .where(
      and(
        isNull(profiles.archivedAt),
        sql`not exists (select 1 from ${userRoles} ur where ur.user_id = ${accessible.userId} and ur.role = 'super_admin')`,
      ),
    );
}

/** True when `viewerId` shares a project or account with `otherId` (ports shares_project). */
export async function sharesProject(
  db: DbExecutor,
  viewerId: string,
  otherId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.id, otherId), sharesProjectWith(viewerId)))
    .limit(1);
  return rows.length > 0;
}
