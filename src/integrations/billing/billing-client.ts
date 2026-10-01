import pRetry, { AbortError } from "p-retry";
import { env } from "../../config/env.js";
import { AppError, ExternalServiceError } from "../../shared/http/errors.js";

export const BILLING_REPORTS = ["options", "kpis", "trends", "services", "projects"] as const;
export type BillingReport = (typeof BILLING_REPORTS)[number];

const TRANSIENT = new Set([429, 502, 503, 504]);

/** GET an allowlisted report from the billing API; the key and tenant never leave the server. */
export async function fetchBillingReport(
  report: BillingReport,
  params: Record<string, string>,
): Promise<unknown> {
  if (!env.BILLING_API_URL || !env.BILLING_API_KEY || !env.BILLING_TENANT_ID) {
    throw new AppError(503, "BILLING_NOT_CONFIGURED", "The billing report is not configured.");
  }
  const url = new URL(`/api/billing/${report}`, env.BILLING_API_URL);
  url.search = new URLSearchParams({ ...params, tenantId: env.BILLING_TENANT_ID }).toString();
  try {
    const payload = await pRetry(
      async () => {
        const response = await fetch(url, {
          headers: { "X-API-Key": env.BILLING_API_KEY! },
          signal: AbortSignal.timeout(15_000),
        });
        if (TRANSIENT.has(response.status)) throw new Error(`billing ${response.status}`);
        if (!response.ok) throw new AbortError(`billing ${response.status}`);
        return (await response.json()) as unknown;
      },
      { retries: 2, minTimeout: 500, maxTimeout: 3_000 },
    );
    return payload && typeof payload === "object" && "data" in payload
      ? (payload as { data: unknown }).data
      : payload;
  } catch (error) {
    throw new ExternalServiceError("The billing service", { cause: error });
  }
}
