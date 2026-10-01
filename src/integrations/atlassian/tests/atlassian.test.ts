import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { adfToDocumentJson, adfToText } from "../adf.js";
import {
  AtlassianHttpError,
  ForeignHostError,
  jiraBinary,
  jiraRequest,
  resolveAttachmentUrl,
} from "../atlassian-client.js";
import { CredentialDecryptError, createCredentialCipher } from "../credential-crypto.js";

const SECRET = "unit-test-secret-that-is-long-enough-0123456789";
const credentials = { cloudId: "cloud-1", accessToken: "secret-token" };

afterEach(() => vi.restoreAllMocks());

describe("jiraBinary host policy", () => {
  it("rewrites site URLs to the API gateway of the connected cloud", () => {
    expect(
      resolveAttachmentUrl(
        "cloud-1",
        "https://acme.atlassian.net/rest/api/3/attachment/content/9?x=1",
      ).href,
    ).toBe("https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/attachment/content/9?x=1");
    const gateway = "https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/attachment/content/9";
    expect(resolveAttachmentUrl("cloud-1", gateway).href).toBe(gateway);
  });

  it.each([
    "https://evil.example.com/rest/api/3/attachment/content/9",
    "https://atlassian.net.evil.example/x",
    "http://acme.atlassian.net/rest/api/3/attachment/content/9",
    "https://api.atlassian.com/ex/jira/other-cloud/rest/api/3/attachment/content/9",
    "https://api.atlassian.com/oauth/token",
    "https://user:pw@acme.atlassian.net/x",
    "not a url",
  ])("refuses %s without sending any request", async (url) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(jiraBinary(credentials, url, 1024)).rejects.toBeInstanceOf(ForeignHostError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("follows redirects without the bearer token and enforces the size cap", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      seen.push({ url, auth: new Headers(init?.headers).get("authorization") });
      if (url.startsWith("https://api.atlassian.com/"))
        return new Response(null, {
          status: 302,
          headers: { location: "https://media.example/f" },
        });
      return new Response(new Uint8Array(2048));
    });
    await expect(
      jiraBinary(credentials, "https://acme.atlassian.net/rest/api/3/attachment/content/1", 1024),
    ).rejects.toThrow("size limit");
    expect(seen).toEqual([
      expect.objectContaining({
        url: expect.stringContaining("api.atlassian.com"),
        auth: "Bearer secret-token",
      }),
      { url: "https://media.example/f", auth: null },
    ]);
  });
});

describe("jiraRequest retries", () => {
  it("retries 429/5xx at most twice and never retries other client errors", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        async () => new Response("{}", { status: 503, headers: { "retry-after": "0" } }),
      );
    await expect(jiraRequest(credentials, "/rest/api/3/myself")).rejects.toMatchObject({
      status: 503,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    fetchSpy.mockReset().mockImplementation(async () => new Response("{}", { status: 404 }));
    const error = await jiraRequest(credentials, "/rest/api/3/myself").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AtlassianHttpError);
    expect((error as AtlassianHttpError).status).toBe(404);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    let attempts = 0;
    fetchSpy.mockReset().mockImplementation(async () => {
      attempts += 1;
      return attempts === 1
        ? new Response("{}", { status: 429, headers: { "retry-after": "0" } })
        : Response.json({ ok: true });
    });
    await expect(jiraRequest(credentials, "/rest/api/3/myself")).resolves.toEqual({ ok: true });
  });
});

describe("credential envelope", () => {
  it("round-trips, uses a fresh IV each time and rejects tampering or plaintext", () => {
    const cipher = createCredentialCipher(SECRET);
    const a = cipher.encrypt("token-value");
    const b = cipher.encrypt("token-value");
    expect(a).toMatch(/^v1\.[\w-]{16}\.[\w-]+$/);
    expect(a).not.toBe(b);
    expect(cipher.decrypt(a)).toBe("token-value");
    const [v, iv, data] = a.split(".");
    const flipped = `${v}.${iv}.${data!.slice(0, -2)}${data!.endsWith("A") ? "B" : "A"}${data!.slice(-1)}`;
    expect(() => cipher.decrypt(flipped)).toThrow(CredentialDecryptError);
    expect(() => cipher.decrypt("plain-token")).toThrow(CredentialDecryptError);
    expect(() => createCredentialCipher(`${SECRET}x`).decrypt(a)).toThrow(CredentialDecryptError);
  });

  it("reads envelopes written by the source app's WebCrypto implementation", async () => {
    const material = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(SECRET));
    const key = await webcrypto.subtle.importKey("raw", material, { name: "AES-GCM" }, false, [
      "encrypt",
    ]);
    const iv = webcrypto.getRandomValues(new Uint8Array(12));
    const sealed = new Uint8Array(
      await webcrypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        new TextEncoder().encode("legacy"),
      ),
    );
    const envelope = `v1.${Buffer.from(iv).toString("base64url")}.${Buffer.from(sealed).toString("base64url")}`;
    expect(createCredentialCipher(` ${SECRET} `).decrypt(envelope)).toBe("legacy");
  });
});

describe("ADF conversion", () => {
  it("keeps links in text and converts formatting for the editor", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "See ", marks: [{ type: "strong" }] },
            {
              type: "text",
              text: "docs",
              marks: [{ type: "link", attrs: { href: "https://d.example" } }],
            },
          ],
        },
      ],
    };
    expect(adfToText(adf)).toBe("See docs (https://d.example)\n");
    expect(adfToDocumentJson(adf)).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "See ", marks: [{ type: "bold" }] },
            {
              type: "text",
              text: "docs",
              marks: [
                {
                  type: "link",
                  attrs: {
                    href: "https://d.example",
                    target: "_blank",
                    rel: "noopener noreferrer nofollow",
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(adfToDocumentJson({ type: "doc", content: [] })).toBeNull();
  });
});
