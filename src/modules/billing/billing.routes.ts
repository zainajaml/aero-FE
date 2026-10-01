import { z } from "zod";
import { BILLING_REPORTS, fetchBillingReport } from "../../integrations/billing/billing-client.js";
import { defineRoute } from "../../shared/http/route.js";
import { requireSuperAdmin } from "../access/access.service.js";

export const billingRoutes = [
  defineRoute({
    method: "get",
    path: "/billing/:report",
    operationId: "getBillingReport",
    summary:
      "GCP billing report proxy (super admins). Query parameters are forwarded to the billing API.",
    tags: ["billing"],
    request: {
      params: z.object({ report: z.enum(BILLING_REPORTS) }),
      query: z.object({}).catchall(z.string().max(2000)),
    },
    response: {
      status: 200,
      schema: z.unknown().meta({ id: "BillingReport", description: "Upstream report payload" }),
    },
    errors: [403, 502, 503],
    handler: ({ actor, params, query }) => {
      requireSuperAdmin(actor);
      return fetchBillingReport(params.report, query as Record<string, string>);
    },
  }),
];
