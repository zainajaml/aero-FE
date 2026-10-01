import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import {
  APP_ORIGIN,
  addMember,
  app,
  createAccount,
  createActor,
  createProject,
} from "../support/actors.js";
import { resetDatabase } from "../support/db.js";

beforeEach(resetDatabase);

// Smallest valid PNG (1×1 transparent pixel).
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

async function team() {
  const project = await createProject((await createAccount()).id);
  const uploader = await createActor();
  await addMember(project.id, uploader.id, "developer");
  const teammate = await createActor();
  await addMember(project.id, teammate.id, "viewer");
  const outsider = await createActor();
  await addMember((await createProject((await createAccount()).id)).id, outsider.id, "developer");
  return { project, uploader, teammate, outsider };
}

describe("document images", () => {
  it("stores an inline image privately and signs it only for related people", async () => {
    const { uploader, teammate, outsider } = await team();
    const upload = await uploader.agent
      .post("/api/v1/files/document-images")
      .set("Origin", APP_ORIGIN)
      .attach("file", PNG, "pixel.png");
    expect(upload.status).toBe(201);
    const key = upload.body.data.key as string;
    expect(key.startsWith(`${uploader.id}/`)).toBe(true);

    const download = await fetch(upload.body.data.url);
    expect(download.status).toBe(200);
    expect(Buffer.from(await download.arrayBuffer()).equals(PNG)).toBe(true);

    const sign = (actor: typeof teammate) =>
      actor.agent
        .post("/api/v1/files/signed-urls")
        .set("Origin", APP_ORIGIN)
        .send({ area: "document-images", keys: [key] });
    expect(Object.keys((await sign(teammate)).body.data.urls)).toEqual([key]);
    expect((await sign(outsider)).body.data.urls).toEqual({});
  });

  it("rejects non-images (by content, not by name), oversized files and viewers", async () => {
    const { uploader } = await team();
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const disguised = await uploader.agent
      .post("/api/v1/files/document-images")
      .set("Origin", APP_ORIGIN)
      .attach("file", svg, "image.png");
    expect(disguised.status).toBe(400);
    const huge = await uploader.agent
      .post("/api/v1/files/document-images")
      .set("Origin", APP_ORIGIN)
      .attach("file", Buffer.alloc(11 * 1024 * 1024), "big.png");
    expect(huge.status).toBe(400);
    const viewer = await createActor({ roles: ["viewer"] });
    const denied = await viewer.agent
      .post("/api/v1/files/document-images")
      .set("Origin", APP_ORIGIN)
      .attach("file", PNG, "p.png");
    expect(denied.status).toBe(403);
  });

  it("requires a file and a signed-in caller", async () => {
    const { uploader } = await team();
    expect(
      (await uploader.agent.post("/api/v1/files/document-images").set("Origin", APP_ORIGIN)).status,
    ).toBe(400);
    const anonymous = await request(app)
      .post("/api/v1/files/signed-urls")
      .send({ area: "avatars", keys: ["x/y"] });
    expect(anonymous.status).toBe(401);
  });
});
