import type { AnyRoute } from "./shared/http/route.js";
import { meRoutes } from "./modules/access/me.routes.js";
import { accountRoutes } from "./modules/accounts/accounts.routes.js";
import { fileRoutes } from "./modules/files/files.routes.js";
import { invitationRoutes } from "./modules/invitations/invitations.routes.js";
import { onboardingRoutes } from "./modules/onboarding/onboarding.routes.js";
import { projectRoutes } from "./modules/projects/projects.routes.js";
import { peopleRoutes } from "./modules/users/people.routes.js";

/** Every /api/v1 operation, in one list, so the router and the OpenAPI document cannot diverge. */
export const apiRoutes: AnyRoute[] = [
  ...meRoutes,
  ...invitationRoutes,
  ...onboardingRoutes,
  ...accountRoutes,
  ...projectRoutes,
  ...peopleRoutes,
  ...fileRoutes,
];
