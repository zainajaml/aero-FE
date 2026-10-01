import { env } from "../../config/env.js";
import {
  createCredentialCipher,
  type CredentialCipher,
} from "../../integrations/atlassian/credential-crypto.js";
import type { OAuthClient } from "../../integrations/atlassian/atlassian-client.js";
import { AppError } from "../../shared/http/errors.js";

export type JiraConfig = { oauth: OAuthClient; cipher: CredentialCipher };

let cached: JiraConfig | null = null;

export function isJiraConfigured(): boolean {
  return Boolean(
    env.JIRA_CLIENT_ID &&
    env.JIRA_CLIENT_SECRET &&
    env.JIRA_REDIRECT_URI &&
    env.JIRA_TOKEN_ENCRYPTION_KEY,
  );
}

class JiraNotConfiguredError extends AppError {
  constructor() {
    super(503, "JIRA_NOT_CONFIGURED", "The Jira integration is not configured.");
  }
}

/** OAuth client settings and the credential cipher; 503 JIRA_NOT_CONFIGURED when unset. */
export function jiraConfig(): JiraConfig {
  if (cached) return cached;
  if (!isJiraConfigured()) throw new JiraNotConfiguredError();
  cached = {
    oauth: {
      clientId: env.JIRA_CLIENT_ID!,
      clientSecret: env.JIRA_CLIENT_SECRET!,
      redirectUri: env.JIRA_REDIRECT_URI!,
    },
    cipher: createCredentialCipher(env.JIRA_TOKEN_ENCRYPTION_KEY!),
  };
  return cached;
}
