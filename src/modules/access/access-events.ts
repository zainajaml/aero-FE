import pg from "pg";
import { env } from "../../config/env.js";
import { logger } from "../../shared/observability/logger.js";

type Listener = () => void;

/**
 * Fans out Postgres `access_changed` notifications to the open SSE connections of the affected
 * user. One dedicated LISTEN connection per process; every replica receives every notification.
 */
class AccessEventHub {
  private readonly listeners = new Map<string, Set<Listener>>();
  private client: pg.Client | null = null;
  private connecting: Promise<void> | null = null;

  subscribe(userId: string, listener: Listener): () => void {
    void this.ensureConnected();
    const set = this.listeners.get(userId) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(userId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(userId);
    };
  }

  private ensureConnected(): Promise<void> {
    if (this.client) return Promise.resolve();
    this.connecting ??= this.connect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async connect(): Promise<void> {
    const client = new pg.Client({
      connectionString: env.DATABASE_URL,
      application_name: "aero-zenith-flow-access-events",
    });
    client.on("notification", (message) => {
      if (message.channel !== "access_changed" || !message.payload) return;
      this.listeners.get(message.payload)?.forEach((listener) => listener());
    });
    client.on("error", (error) => {
      logger.warn({ err: error }, "access event listener lost its connection; reconnecting");
      this.client = null;
      setTimeout(() => void this.ensureConnected(), 2_000).unref();
    });
    try {
      await client.connect();
      await client.query("LISTEN access_changed");
      this.client = client;
    } catch (error) {
      logger.warn({ err: error }, "access event listener could not connect; retrying");
      await client.end().catch(() => undefined);
      setTimeout(() => void this.ensureConnected(), 5_000).unref();
    }
  }

  async close(): Promise<void> {
    await this.client?.end().catch(() => undefined);
    this.client = null;
  }
}

export const accessEvents = new AccessEventHub();
