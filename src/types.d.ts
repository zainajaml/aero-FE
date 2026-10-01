import type { Actor } from "./modules/access/access.types.js";

declare module "express-serve-static-core" {
  interface Request {
    id: string;
    /** Set by the authenticate middleware for signed-in requests. */
    actor?: Actor;
  }
}
