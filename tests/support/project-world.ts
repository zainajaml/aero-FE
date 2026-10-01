import { db } from "../../src/database/client.js";
import { boardColumns } from "../../src/database/schema/index.js";
import {
  addMember,
  createAccount,
  createActor,
  createProject,
  makeAccountAdmin,
  type TestActor,
  APP_ORIGIN,
} from "./actors.js";

export type World = Awaited<ReturnType<typeof projectWorld>>;

/** A project with board columns and one actor per role, plus an outsider in another project. */
export async function projectWorld() {
  const account = await createAccount();
  const project = await createProject(account.id, {
    key: `T${Date.now().toString(36).slice(-4).toUpperCase()}`,
  });
  const columns = await db
    .insert(boardColumns)
    .values([
      { projectId: project.id, name: "To Do", orderIndex: 0 },
      { projectId: project.id, name: "In Progress", orderIndex: 1 },
      { projectId: project.id, name: "Done", orderIndex: 2, isDone: true },
    ])
    .returning();
  const accountAdmin = await createActor({ name: "Acc Admin" });
  await makeAccountAdmin(account.id, accountAdmin.id);
  const manager = await createActor({ name: "Pat Manager" });
  await addMember(project.id, manager.id, "admin");
  const developer = await createActor({ name: "Dev Eloper" });
  await addMember(project.id, developer.id, "developer");
  const teammate = await createActor({ name: "Tea Mate" });
  await addMember(project.id, teammate.id, "developer");
  const viewer = await createActor({ name: "Vi Ewer" });
  await addMember(project.id, viewer.id, "viewer");
  const outsider = await createActor({ name: "Out Sider" });
  await addMember((await createProject((await createAccount()).id)).id, outsider.id, "admin");
  return {
    account,
    project,
    columns: columns as [(typeof columns)[0], (typeof columns)[0], (typeof columns)[0]],
    accountAdmin,
    manager,
    developer,
    teammate,
    viewer,
    outsider,
  };
}

export const doc = (text: string, mentions: { id: string; label: string }[] = []) => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text }, ...mentions.map((m) => ({ type: "mention", attrs: m }))],
    },
  ],
});

export function call(
  actor: TestActor,
  method: "get" | "post" | "patch" | "put" | "delete",
  path: string,
  body?: object,
) {
  const request = actor.agent[method](`/api/v1${path}`).set("Origin", APP_ORIGIN);
  return body ? request.send(body) : request;
}

export async function newTicket(
  actor: TestActor,
  projectId: string,
  extra: Record<string, unknown> = {},
) {
  const response = await call(actor, "post", `/projects/${projectId}/tickets`, {
    title: "Ticket",
    descriptionJson: doc("Do it"),
    type: "task",
    priority: "medium",
    ...extra,
  });
  if (response.status !== 201) throw new Error(`create failed ${response.status} ${response.text}`);
  return response.body.data as {
    id: string;
    code: string;
    position: number;
    sprintId: string | null;
    columnId: string | null;
    estimateMinutes: number;
  };
}
