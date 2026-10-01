import type { RequestHandler } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../../modules/auth/auth.js";
import { loadActor } from "../../modules/access/access.service.js";
import { ForbiddenError } from "../http/errors.js";

/**
 * Resolves the session cookie to a verified actor. Anonymous requests continue without
 * req.actor; routes decide whether that is allowed. Archived identities are rejected outright.
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (session) {
      const actor = await loadActor(session.user.id);
      if (actor?.isArchived)
        throw new ForbiddenError("This account has been archived.", "ACCOUNT_ARCHIVED");
      if (actor) req.actor = actor;
    }
    next();
  } catch (error) {
    next(error);
  }
};
