import { resolve } from "node:path";
import type { Command } from "commander";
import { loadConfig } from "../../config/load.js";
import { SqliteStore } from "../../persistence/sqlite.js";
import { GatewayServer } from "../../gateway/index.js";
import { loadDotEnv, resolveWorkspace } from "../env.js";

export function registerGateway(program: Command): void {
  const cmd = program
    .command("gateway")
    .description("Interaction Gateway API + channel adapters (Telegram/Slack)");

  cmd
    .command("start")
    .description("Start Gateway API, web GUI, and channel adapters")
    .option("--workspace <path>", "Workspace path")
    .option("--host <host>", "Bind host (default 127.0.0.1)", "127.0.0.1")
    .option("--port <port>", "Bind port", "8787")
    .action(async (opts: { workspace?: string; host: string; port: string }) => {
      const workspace = resolve(opts.workspace ?? resolveWorkspace());
      loadDotEnv(workspace);
      const config = loadConfig(workspace);
      const store = new SqliteStore(config.dbPath);
      store.initialize();

      if (opts.host !== "127.0.0.1" && opts.host !== "localhost") {
        console.warn(
          "WARNING: Gateway bound beyond loopback. Ensure authentication before exposing remotely.",
        );
      }

      const handle = await new GatewayServer({
        store,
        config,
        host: opts.host,
        port: Number(opts.port),
      }).start();

      console.log(`Forge Gateway: ${handle.url}`);
      console.log(`Web GUI:       ${handle.url}/`);
      console.log("Press Ctrl+C to stop.");

      const shutdown = async () => {
        await handle.close();
        store.close();
        process.exit(0);
      };
      process.on("SIGINT", () => void shutdown());
      process.on("SIGTERM", () => void shutdown());
      await new Promise(() => undefined);
    });

  cmd
    .command("status")
    .description("Show gateway/channel health via local HTTP")
    .option("--url <url>", "Gateway base URL", "http://127.0.0.1:8787")
    .action(async (opts: { url: string }) => {
      try {
        const res = await fetch(`${opts.url.replace(/\/$/, "")}/api/system/status`);
        if (!res.ok) {
          console.error(`Gateway unreachable: HTTP ${res.status}`);
          process.exitCode = 1;
          return;
        }
        const body = await res.json();
        console.log(JSON.stringify(body, null, 2));
      } catch (err) {
        console.error(
          `Gateway unreachable at ${opts.url}: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
      }
    });

  cmd
    .command("stop")
    .description("Request gateway stop (SIGINT to the gateway process)")
    .action(() => {
      console.log(
        "Stop the gateway process with Ctrl+C, or terminate the PID that bound the port.",
      );
    });

  cmd
    .command("channels")
    .description("List channel adapter health")
    .option("--url <url>", "Gateway base URL", "http://127.0.0.1:8787")
    .action(async (opts: { url: string }) => {
      try {
        const res = await fetch(`${opts.url.replace(/\/$/, "")}/api/gateway/channels`);
        const body = await res.json();
        console.log(JSON.stringify(body, null, 2));
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  cmd
    .command("pairings")
    .description("List pending channel pairings")
    .option("--url <url>", "Gateway base URL", "http://127.0.0.1:8787")
    .action(async (opts: { url: string }) => {
      try {
        const res = await fetch(`${opts.url.replace(/\/$/, "")}/api/pairings`);
        const body = await res.json();
        console.log(JSON.stringify(body, null, 2));
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  cmd
    .command("setup")
    .description("Print channel credential setup help (never prints secrets)")
    .action(() => {
      console.log(`Forge channel setup

Environment variables (never commit):
  TELEGRAM_BOT_TOKEN=...
  SLACK_BOT_TOKEN=...
  SLACK_SIGNING_SECRET=...
  WHATSAPP_ACCESS_TOKEN=...   # stub until Cloud API wired

Then:
  forge-harness gateway start --port 8787

Approve Telegram/Slack users via GUI Approvals/Pairings or:
  POST /api/pairings/:id/approve

Default bind is 127.0.0.1 only.
`);
    });
}

export function registerStart(program: Command): void {
  program
    .command("start")
    .description("Start Forge Gateway (API + web GUI + channels)")
    .option("--workspace <path>", "Workspace path")
    .option("--host <host>", "Bind host", "127.0.0.1")
    .option("--port <port>", "Bind port", "8787")
    .action(async (opts: { workspace?: string; host: string; port: string }) => {
      // Delegate to gateway start by re-parsing would be awkward; call same logic
      const workspace = resolve(opts.workspace ?? resolveWorkspace());
      loadDotEnv(workspace);
      const config = loadConfig(workspace);
      const store = new SqliteStore(config.dbPath);
      store.initialize();
      const handle = await new GatewayServer({
        store,
        config,
        host: opts.host,
        port: Number(opts.port),
      }).start();
      console.log(`Forge started: ${handle.url}`);
      console.log(`Open dashboard: ${handle.url}/`);
      const shutdown = async () => {
        await handle.close();
        store.close();
        process.exit(0);
      };
      process.on("SIGINT", () => void shutdown());
      process.on("SIGTERM", () => void shutdown());
      await new Promise(() => undefined);
    });
}
