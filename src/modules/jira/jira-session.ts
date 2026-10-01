import {
  jiraBinary,
  jiraRequest,
  type JiraCredentials,
} from "../../integrations/atlassian/atlassian-client.js";
import { getValidConnection, type LiveConnection } from "./connection.service.js";
import { JiraSiteMismatchError } from "./jira.errors.js";

const REUSE_MARGIN_MS = 60_000;

/**
 * Jira API access for one user during one request. The decrypted connection is reused until it
 * nears expiry. With `expectedCloudId`, every call fails when the user has switched to another
 * site, so a resumed import never reads from a different Jira instance.
 */
export class JiraSession {
  private connection: LiveConnection | null = null;

  constructor(
    readonly userId: string,
    private readonly expectedCloudId?: string,
  ) {}

  async credentials(): Promise<JiraCredentials> {
    if (!this.connection || this.connection.expiresAt.getTime() - Date.now() < REUSE_MARGIN_MS) {
      this.connection = await getValidConnection(this.userId);
    }
    if (this.expectedCloudId && this.connection.cloudId !== this.expectedCloudId)
      throw new JiraSiteMismatchError();
    return { cloudId: this.connection.cloudId, accessToken: this.connection.accessToken };
  }

  async api<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
    return jiraRequest<T>(await this.credentials(), path, init);
  }

  async binary(contentUrl: string, maxBytes: number) {
    return jiraBinary(await this.credentials(), contentUrl, maxBytes);
  }
}
