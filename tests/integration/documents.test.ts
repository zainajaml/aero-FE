import { beforeEach, describe, expect, it } from "vitest";
import { APP_ORIGIN } from "../support/actors.js";
import { resetDatabase } from "../support/db.js";
import { call, doc, projectWorld } from "../support/project-world.js";

beforeEach(resetDatabase);

describe("documents", () => {
  it("lets editors create, save and organise documents; viewers only read", async () => {
    const w = await projectWorld();
    const folder = (
      await call(w.developer, "post", `/projects/${w.project.id}/document-folders`, {})
    ).body.data;
    expect(folder.name).toBe("New Folder");
    const created = (
      await call(w.developer, "post", `/projects/${w.project.id}/documents`, {
        folderId: folder.id,
      })
    ).body.data;
    expect(created.title).toBe("Untitled");
    await call(w.developer, "patch", `/documents/${created.id}`, {
      title: "Spec",
      content: doc("Hello"),
    });
    const viewed = (await call(w.viewer, "get", `/documents/${created.id}`)).body.data;
    expect(viewed).toMatchObject({
      title: "Spec",
      canEdit: false,
      canDelete: false,
      folderId: folder.id,
    });
    expect(
      (await call(w.viewer, "patch", `/documents/${created.id}`, { title: "No" })).status,
    ).toBe(403);
    expect((await call(w.outsider, "get", `/documents/${created.id}`)).status).toBe(404);
    await call(w.developer, "post", `/documents/${created.id}/move`, { folderId: null });
    const library = (await call(w.viewer, "get", `/documents?projectId=${w.project.id}`)).body.data;
    expect(library.documents[0]).toMatchObject({ id: created.id, folderId: null });
    expect(library.documents[0].content).toBeUndefined();
    expect((await call(w.teammate, "delete", `/documents/${created.id}`)).status).toBe(403);
    expect((await call(w.developer, "delete", `/documents/${created.id}`)).status).toBe(204);
  });

  it("stores uploaded files privately and streams them to members only", async () => {
    const w = await projectWorld();
    const upload = await w.developer.agent
      .post(`/api/v1/projects/${w.project.id}/documents/files`)
      .set("Origin", APP_ORIGIN)
      .attach("file", Buffer.from("%PDF-1.4 test"), "brief.pdf");
    expect(upload.status).toBe(201);
    expect(upload.body.data.file.mime).toBe("application/pdf");
    const file = await w.viewer.agent
      .get(`/api/v1/documents/${upload.body.data.id}/file`)
      .buffer(true);
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toContain("application/pdf");
    expect(
      (await w.outsider.agent.get(`/api/v1/documents/${upload.body.data.id}/file`)).status,
    ).toBe(404);
    expect((await call(w.manager, "delete", `/documents/${upload.body.data.id}`)).status).toBe(204);
  });

  it("lists tag suggestions limited to visible projects", async () => {
    const w = await projectWorld();
    await call(w.developer, "post", `/projects/${w.project.id}/documents`, { title: "Runbook" });
    expect(
      (await call(w.viewer, "get", `/documents/tags?projectId=${w.project.id}`)).body.data.map(
        (t: { title: string }) => t.title,
      ),
    ).toEqual(["Runbook"]);
    expect(
      (await call(w.outsider, "get", `/documents/tags?projectId=${w.project.id}`)).body.data,
    ).toEqual([]);
  });
});
