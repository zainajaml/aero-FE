import type { AnyRoute } from "./shared/http/route.js";
import { meRoutes } from "./modules/access/me.routes.js";

/** Every /api/v1 operation, in one list, so the router and the OpenAPI document cannot diverge. */
export const apiRoutes: AnyRoute[] = [...meRoutes];
