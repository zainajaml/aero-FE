import { vi } from "vitest";

// In-process stand-in for auth.atlassian.com / api.atlassian.com / api.media.atlassian.com.
// It replaces global fetch for those hosts only; every other URL goes to the real fetch.

export const CLOUD_ID = "cloud-1";
export const OTHER_CLOUD_ID = "cloud-2";
const ATTACHMENT_BYTES = Buffer.from("%PDF-1.4 fake attachment bytes");

export type RecordedCall = { url: URL; method: string; authorization: string | null };

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const doc = (text: string) => ({
  type: "doc",
  version: 1,
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const alice = { accountId: "acc-alice", displayName: "Alice Jira", emailAddress: "" };
const bob = { accountId: "acc-bob", displayName: "Bob Builder", emailAddress: "bob@jira.example" };
const hidden = { accountId: "acc-hidden", displayName: "Hidden Person" };

/** Two issues: one in sprint 7 with a comment, a work log and a file; one under an epic. */
function demoIssues() {
  return [
    {
      id: "10001",
      key: "DEMO-1",
      fields: {
        summary: "First issue",
        description: doc("Fix the login page"),
        status: { name: "In Progress" },
        issuetype: { name: "Bug" },
        priority: { name: "Highest" },
        assignee: alice,
        reporter: bob,
        duedate: "2026-12-01",
        timeoriginalestimate: 7200,
        attachment: [
          {
            id: "900",
            filename: "spec.pdf",
            mimeType: "application/pdf",
            size: ATTACHMENT_BYTES.length,
            created: "2026-01-02T10:00:00.000+0000",
            content: "https://acme.atlassian.net/rest/api/3/attachment/content/900",
          },
        ],
        comment: {
          comments: [
            {
              id: "500",
              author: bob,
              created: "2026-01-03T10:00:00.000+0000",
              body: doc("Looks good"),
            },
          ],
        },
        worklog: {
          worklogs: [
            {
              id: "700",
              author: bob,
              started: "2026-01-04T09:00:00.000+0000",
              timeSpentSeconds: 3600,
              comment: doc("Investigated"),
            },
          ],
        },
      },
    },
    {
      id: "10002",
      key: "DEMO-2",
      fields: {
        summary: "Second issue",
        status: { name: "Done" },
        issuetype: { name: "Story" },
        priority: { name: "Low" },
        assignee: hidden,
        reporter: null,
        parent: { key: "DEMO-9", fields: { summary: "Big Epic", issuetype: { name: "Epic" } } },
        comment: { comments: [] },
        worklog: { worklogs: [] },
      },
    },
  ];
}

export class FakeAtlassian {
  calls: RecordedCall[] = [];
  refreshCount = 0;
  issues = demoIssues();
  private tokenSerial = 0;
  private realFetch = globalThis.fetch;

  install() {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      if (!url.hostname.endsWith("atlassian.com")) return this.realFetch(input, init);
      const headers = new Headers(init?.headers);
      const call = {
        url,
        method: (init?.method ?? "GET").toUpperCase(),
        authorization: headers.get("authorization"),
      };
      this.calls.push(call);
      return this.route(call, init?.body ? JSON.parse(String(init.body)) : undefined);
    });
    return this;
  }

  restore() {
    vi.restoreAllMocks();
  }

  callsTo(pathPart: string) {
    return this.calls.filter((c) => c.url.pathname.includes(pathPart));
  }

  private async route(call: RecordedCall, body: Record<string, string> | undefined) {
    const { url, method } = call;
    if (url.hostname === "auth.atlassian.com" && url.pathname === "/oauth/token") {
      if (body?.grant_type === "authorization_code") {
        if (body.code !== "good-code") return json({ error: "invalid_grant" }, 400);
        return json({
          access_token: "access-token-initial",
          refresh_token: "refresh-token-initial",
          expires_in: 3600,
          scope: "read:jira-work offline_access",
        });
      }
      if (body?.grant_type === "refresh_token") {
        this.refreshCount += 1;
        // Slow enough that concurrent refreshes would overlap without serialization.
        await new Promise((resolve) => setTimeout(resolve, 50));
        this.tokenSerial += 1;
        return json({
          access_token: `access-token-refreshed-${this.tokenSerial}`,
          refresh_token: `refresh-token-${this.tokenSerial}`,
          expires_in: 3600,
        });
      }
      return json({}, 400);
    }
    if (url.hostname === "api.media.atlassian.com") {
      return new Response(ATTACHMENT_BYTES, { headers: { "content-type": "application/pdf" } });
    }
    if (url.pathname === "/oauth/token/accessible-resources") {
      return json([
        { id: CLOUD_ID, name: "Acme", url: "https://acme.atlassian.net" },
        { id: OTHER_CLOUD_ID, name: "Other", url: "https://other.atlassian.net" },
      ]);
    }
    const prefix = `/ex/jira/${CLOUD_ID}`;
    if (!url.pathname.startsWith(prefix)) return json({}, 404);
    const path = url.pathname.slice(prefix.length);
    if (path === "/rest/api/3/project/search") {
      return json({ values: [{ id: "10000", key: "DEMO", name: "Demo Project" }] });
    }
    if (path === "/rest/agile/1.0/board") return json({ values: [{ id: 1, type: "scrum" }] });
    if (path === "/rest/agile/1.0/board/1/sprint") {
      return json({
        values: [
          {
            id: 7,
            name: "Sprint 7",
            state: "active",
            startDate: "2026-01-01T00:00:00.000Z",
            endDate: "2026-01-14T00:00:00.000Z",
          },
        ],
        isLast: true,
      });
    }
    if (path === "/rest/agile/1.0/sprint/7/issue") return json({ issues: [{ key: "DEMO-1" }] });
    if (path === "/rest/api/3/field") return json([]);
    if (path === "/rest/api/3/project/DEMO/statuses") {
      return json([
        {
          statuses: [
            { name: "Done", statusCategory: { key: "done" } },
            { name: "To Do", statusCategory: { key: "new" } },
            { name: "In Progress", statusCategory: { key: "indeterminate" } },
          ],
        },
      ]);
    }
    if (path === "/rest/api/3/search/approximate-count" && method === "POST") {
      return json({ count: this.issues.length });
    }
    if (path === "/rest/api/3/search/jql") {
      return json({ issues: this.issues, total: this.issues.length });
    }
    if (path === "/rest/api/3/attachment/content/900") {
      return new Response(null, {
        status: 303,
        headers: { location: "https://api.media.atlassian.com/file/abc/binary?token=signed" },
      });
    }
    return json({ errorMessages: ["not found"] }, 404);
  }
}
