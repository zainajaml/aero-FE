import { sql } from "drizzle-orm";
import { check, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { updatedAt } from "./_shared.js";
import { users } from "./users.js";

export const EMPLOYMENT_STATUSES = ["full_time", "part_time", "contract", "project"] as const;

export const profilePrivate = pgTable(
  "profile_private",
  {
    id: uuid("id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    mobile: text("mobile"),
    employeeNumber: text("employee_number"),
    employmentStatus: text("employment_status"),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      "profile_private_employment_status_check",
      sql`${t.employmentStatus} IS NULL OR ${t.employmentStatus} IN ('full_time', 'part_time', 'contract', 'project')`,
    ),
  ],
);
