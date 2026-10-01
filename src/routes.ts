import type { AnyRoute } from "./shared/http/route.js";
import { meRoutes } from "./modules/access/me.routes.js";
import { accountRoutes } from "./modules/accounts/accounts.routes.js";
import { billingRoutes } from "./modules/billing/billing.routes.js";
import { boardRoutes } from "./modules/board/board.routes.js";
import { documentRoutes } from "./modules/documents/documents.routes.js";
import { epicRoutes } from "./modules/epics/epics.routes.js";
import { fileRoutes } from "./modules/files/files.routes.js";
import { invitationRoutes } from "./modules/invitations/invitations.routes.js";
import { notificationRoutes } from "./modules/notifications/notifications.routes.js";
import { onboardingRoutes } from "./modules/onboarding/onboarding.routes.js";
import { projectRoutes } from "./modules/projects/projects.routes.js";
import { reportingRoutes } from "./modules/reporting/reporting.routes.js";
import { sprintRoutes } from "./modules/sprints/sprints.routes.js";
import { ticketRoutes } from "./modules/tickets/tickets.routes.js";
import { peopleRoutes } from "./modules/users/people.routes.js";
import { profileRoutes } from "./modules/users/profile.routes.js";

/** Every /api/v1 operation, in one list, so the router and the OpenAPI document cannot diverge. */
export const apiRoutes: AnyRoute[] = [
  ...meRoutes,
  ...profileRoutes,
  ...invitationRoutes,
  ...onboardingRoutes,
  ...accountRoutes,
  ...projectRoutes,
  ...peopleRoutes,
  ...fileRoutes,
  ...notificationRoutes,
  ...boardRoutes,
  ...sprintRoutes,
  ...epicRoutes,
  ...ticketRoutes,
  ...billingRoutes,
  ...reportingRoutes,
  ...documentRoutes,
];
