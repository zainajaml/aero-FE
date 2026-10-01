import { eq } from "drizzle-orm";
import request from "supertest";
import type TestAgent from "supertest/lib/agent.js";
import { createApp } from "../../src/app.js";
import { db } from "../../src/database/client.js";
import {
  accountAdmins,
  accounts,
  projectMembers,
  projects,
  userRoles,
  users,
} from "../../src/database/schema/index.js";
import type { AppRole } from "../../src/database/schema/_shared.js";
import {
  emailTransport,
  type MemoryEmailTransport,
} from "../../src/integrations/email/transport.js";

export const app = createApp();
export const APP_ORIGIN = "http://app.test";
export const PASSWORD = "correct-horse-battery-staple";

export const outbox = () => (emailTransport as MemoryEmailTransport).sent;

let counter = 0;
const unique = () => `${Date.now().toString(36)}${(counter += 1)}`;

export type TestActor = { id: string; email: string; agent: TestAgent };

/** Signs up through the real auth endpoint, marks the email verified and returns a signed-in agent. */
export async function createActor(
  options: { email?: string; name?: string; roles?: AppRole[] } = {},
): Promise<TestActor> {
  const email = options.email ?? `user-${unique()}@example.com`;
  const agent = request.agent(app);
  const signUp = await agent
    .post("/api/auth/sign-up/email")
    .set("Origin", APP_ORIGIN)
    .send({ email, password: PASSWORD, name: options.name ?? "Test User" });
  if (signUp.status !== 200) throw new Error(`sign-up failed: ${signUp.status} ${signUp.text}`);
  const id = signUp.body.user.id as string;
  await db.update(users).set({ emailVerified: true }).where(eq(users.id, id));
  for (const role of options.roles ?? []) await db.insert(userRoles).values({ userId: id, role });
  await signIn(agent, email);
  return { id, email, agent };
}

export async function signIn(agent: TestAgent, email: string, password = PASSWORD) {
  const response = await agent
    .post("/api/auth/sign-in/email")
    .set("Origin", APP_ORIGIN)
    .send({ email, password });
  if (response.status !== 200)
    throw new Error(`sign-in failed: ${response.status} ${response.text}`);
  return response;
}

export async function createAccount(name = `Account ${unique()}`) {
  const [row] = await db
    .insert(accounts)
    .values({ name, slug: name.toLowerCase().replace(/\W+/g, "-") })
    .returning();
  return row!;
}

export async function createProject(
  accountId: string,
  overrides: Partial<typeof projects.$inferInsert> = {},
) {
  const key = `P${unique().toUpperCase().slice(-6)}`;
  const [row] = await db
    .insert(projects)
    .values({ accountId, name: `Project ${key}`, key, ...overrides })
    .returning();
  return row!;
}

export async function addMember(projectId: string, userId: string, role: AppRole) {
  await db.insert(projectMembers).values({ projectId, userId, role });
}

export async function makeAccountAdmin(accountId: string, userId: string) {
  await db.insert(userRoles).values({ userId, role: "account_admin" }).onConflictDoNothing();
  await db.insert(accountAdmins).values({ accountId, userId });
}
