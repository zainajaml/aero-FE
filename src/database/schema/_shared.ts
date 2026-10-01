import { pgEnum, timestamp } from "drizzle-orm/pg-core";

export const APP_ROLES = [
  "super_admin",
  "account_admin",
  "admin",
  "developer",
  "team",
  "viewer",
] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const appRole = pgEnum("app_role", APP_ROLES);

export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
