/**
 * In-process Forge Gateway host for Desktop (DESKTOP-2+).
 * Prefer this when packaged so we do not need a separate Node binary.
 */

import { createServer } from "node:http";
import { loadConfig } from "../config/load.js";
import { SqliteStore } from "../persistence/sqlite.js";
import { GatewayServer, type GatewayHandle } from "../gateway/server.js";
import { pickLoopbackPort } from "./sidecar.js";
import { loadDotEnv } from "../cli/env.js";

export interface RuntimeHandle {
  baseUrl: string;
  port: number;
  mode: "inprocess" | "child";
  stop: () => Promise<void>;
}

/**
 * Start GatewayServer inside the current Node/Electron process on 127.0.0.1.
 */
export async function startInProcessRuntime(input: {
  workspacePath: string;
  host?: string;
  port?: number;
}): Promise<RuntimeHandle> {
  const host = input.host ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("Desktop runtime must bind to 127.0.0.1 only");
  }
  loadDotEnv(input.workspacePath);
  const port = input.port ?? (await pickLoopbackPort());
  const config = loadConfig(input.workspacePath);
  const store = new SqliteStore(config.dbPath);
  store.initialize();

  const handle: GatewayHandle = await new GatewayServer({
    store,
    config,
    host,
    port,
  }).start();

  return {
    baseUrl: handle.url,
    port,
    mode: "inprocess",
    stop: async () => {
      await handle.close();
      store.close();
    },
  };
}

/** True if something already answers on the port (used by restart probes). */
export async function isPortReachable(
  baseUrl: string,
  timeoutMs = 1_500,
): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/system/status`, {
      signal: ctrl.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Ensure ephemeral bind works (sanity for DESKTOP-2 tests). */
export async function assertCanBindLoopback(): Promise<number> {
  const port = await pickLoopbackPort();
  await new Promise<void>((resolve, reject) => {
    const s = createServer();
    s.listen(port, "127.0.0.1", () => {
      s.close((err) => (err ? reject(err) : resolve()));
    });
    s.on("error", reject);
  });
  return port;
}
