import {
  AtlassianHttpError,
  ForeignHostError,
} from "../../integrations/atlassian/atlassian-client.js";
import { CredentialDecryptError } from "../../integrations/atlassian/credential-crypto.js";
import { AppError, ExternalServiceError } from "../../shared/http/errors.js";

export class JiraNotConnectedError extends AppError {
  constructor() {
    super(409, "JIRA_NOT_CONNECTED", "Jira is not connected for this user.");
  }
}

export class JiraReconnectRequiredError extends AppError {
  constructor() {
    super(
      409,
      "JIRA_RECONNECT_REQUIRED",
      "Your Jira connection expired. Reconnect Jira to continue.",
    );
  }
}

export class JiraSiteMismatchError extends AppError {
  constructor() {
    super(
      409,
      "JIRA_SITE_MISMATCH",
      "This import belongs to a different Jira site. Switch back to that site to continue.",
    );
  }
}

/** Jira itself rejected us (expired, revoked or missing connection): the user must reconnect. */
export function isConnectionError(error: unknown): boolean {
  return (
    error instanceof JiraNotConnectedError ||
    error instanceof JiraReconnectRequiredError ||
    error instanceof CredentialDecryptError ||
    (error instanceof AtlassianHttpError &&
      (error.status === 401 || error.status === 403 || error.operation === "token"))
  );
}

/** Maps integration failures to API errors; AppErrors pass through. */
function toJiraAppError(error: unknown): unknown {
  if (error instanceof AppError) return error;
  if (isConnectionError(error)) return new JiraReconnectRequiredError();
  if (error instanceof AtlassianHttpError || error instanceof ForeignHostError)
    return new ExternalServiceError("Jira", { cause: error });
  return error;
}

/** Runs a Jira-backed operation and converts integration failures into API errors. */
export async function withJiraErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw toJiraAppError(error);
  }
}
