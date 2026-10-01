import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "../../database/client.js";

/** Liveness/readiness probes keep a fixed tiny shape for orchestrators (documented envelope exception). */
export const healthRouter = Router();

healthRouter.get("/live", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

healthRouter.get("/ready", async (_req, res) => {
  try {
    await db.execute(sql`select 1`);
    res.status(200).json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "unavailable" });
  }
});
