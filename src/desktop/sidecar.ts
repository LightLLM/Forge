/**
 * Desktop sidecar helpers (DESKTOP-1).
 * Lifecycle only — no agent/business logic. Used by Electron main and tests.
 */

import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

const moduleDir = dirname(fileURLToPath(import.meta.url));

/** Walk upward until forge-harness package.json is found. */
export function resolveForgeRoot(from: string = moduleDir): string {
  let dir = resolve(from);
  for (let i = 0; i < 8; i++) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
        if (pkg.name === "forge-harness") return dir;
      } catch {
        /* continue */
      }
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: two levels up from dist/desktop or one from desktop/
  return resolve(moduleDir, "..", "..");
}

export function pickLoopbackPort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("failed to bind ephemeral loopback port"));
        return;
      }
      const { port } = addr;
      server.close((err) => (err ? reject(err) : resolvePort(port)));
    });
    server.on("error", reject);
  });
}

export function resolveForgeStartCommand(forgeRoot: string): {
  command: string;
  args: string[];
  cwd: string;
} {
  const root = resolve(forgeRoot);
  const distCli = join(root, "dist", "cli", "index.js");
  if (existsSync(distCli)) {
    return {
      command: process.execPath,
      args: [distCli, "start"],
      cwd: root,
    };
  }
  const tsxCli = join(root, "node_modules", "tsx", "dist", "cli.mjs");
  const entry = join(root, "src", "cli", "index.ts");
  if (existsSync(tsxCli) && existsSync(entry)) {
    return {
      command: process.execPath,
      args: [tsxCli, entry, "start"],
      cwd: root,
    };
  }
  throw new Error(
    `Forge CLI not found under ${root}. Run pnpm build or ensure tsx is installed.`,
  );
}

export function buildStartArgs(input: {
  host?: string;
  port: number;
  workspace: string;
}): string[] {
  const host = input.host ?? "127.0.0.1";
  if (!input.port || !input.workspace) {
    throw new Error("port and workspace are required");
  }
  return [
    "--host",
    host,
    "--port",
    String(input.port),
    "--workspace",
    input.workspace,
  ];
}

export async function waitForGateway(
  baseUrl: string,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<Record<string, unknown> & { ok: boolean }> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const intervalMs = options.intervalMs ?? 250;
  const signal = options.signal;
  const url = `${baseUrl.replace(/\/$/, "")}/api/system/status`;
  const deadline = Date.now() + timeoutMs;

  let lastError = "not started";
  while (Date.now() < deadline) {
    if (signal?.aborted) {
      throw new Error("waitForGateway aborted");
    }
    try {
      const res = await fetch(url, { signal });
      if (res.ok) {
        const body = (await res.json()) as { ok?: boolean };
        if (body?.ok) return body as Record<string, unknown> & { ok: boolean };
        lastError = `unexpected status body: ${JSON.stringify(body).slice(0, 120)}`;
      } else {
        lastError = `HTTP ${res.status}`;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Forge Gateway did not become ready at ${url}: ${lastError}`);
}

export interface SidecarHandle {
  pid: number | undefined;
  baseUrl: string;
  child: ChildProcess;
  getLogs: () => { stdout: string; stderr: string };
  stop: () => Promise<void>;
}

export function startForgeSidecar(options: {
  forgeRoot: string;
  workspace: string;
  host?: string;
  port: number;
  env?: NodeJS.ProcessEnv;
}): SidecarHandle {
  const host = options.host ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("Desktop sidecar must bind to 127.0.0.1 only");
  }
  const { command, args: baseArgs, cwd } = resolveForgeStartCommand(
    options.forgeRoot,
  );
  const args = [
    ...baseArgs,
    ...buildStartArgs({
      host,
      port: options.port,
      workspace: options.workspace,
    }),
  ];
  const spawnOpts: SpawnOptions = {
    cwd,
    env: { ...process.env, ...options.env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  };
  const child = spawn(command, args, spawnOpts);

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer | string) => {
    stdout += String(chunk);
    if (stdout.length > 50_000) stdout = stdout.slice(-25_000);
  });
  child.stderr?.on("data", (chunk: Buffer | string) => {
    stderr += String(chunk);
    if (stderr.length > 50_000) stderr = stderr.slice(-25_000);
  });

  const baseUrl = `http://${host}:${options.port}`;

  return {
    pid: child.pid,
    baseUrl,
    child,
    getLogs: () => ({ stdout, stderr }),
    stop: async () => {
      if (child.killed || child.exitCode !== null) return;
      await new Promise<void>((resolveStop) => {
        const timer = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            /* ignore */
          }
          resolveStop();
        }, 5_000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolveStop();
        });
        try {
          child.kill("SIGTERM");
        } catch {
          clearTimeout(timer);
          resolveStop();
        }
      });
    },
  };
}
