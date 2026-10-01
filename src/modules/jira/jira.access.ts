import { db } from "../../database/client.js";
import { ForbiddenError } from "../../shared/http/errors.js";
import * as policy from "../access/access.policy.js";
import type { Actor } from "../access/access.types.js";
import { accountExists } from "./import/import.repository.js";

const IMPORT_DENIED = "You can only import into an account you administer.";

/**
 * Ports authz.server requireAccountAdmin: super admin, or an account_admins grant for exactly
 * this account. The account must exist (fails closed with the same 403).
 */
export async function requireAccountAdmin(
  actor: Actor,
  accountId: string,
  message = IMPORT_DENIED,
): Promise<{ isSuperAdmin: boolean; isAccountAdmin: boolean }> {
  const isSuperAdmin = policy.isSuperAdmin(actor);
  const isAccountAdmin = policy.isAccountAdmin(actor, accountId);
  if (!isSuperAdmin && !isAccountAdmin) throw new ForbiddenError(message);
  if (!(await accountExists(db, accountId))) throw new ForbiddenError(message);
  return { isSuperAdmin, isAccountAdmin };
}
