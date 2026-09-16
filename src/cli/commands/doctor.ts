import { resolve } from "node:path";
import { existsSync } from "node:fs";
import type { Command } from "commander";
import { loadConfig } from "../../config/load.js";
import { OllamaProvider } from "../../models/ollama.js";
import { OpenRouterProvider } from "../../models/openrouter.js";
import { SqliteStore } from "../../persistence/sqlite.js";
import { readPackageScripts } from "../../context/compiler.js";

interface CheckResult {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("Check local Forge environment health")
    .action(async () => {
      const cwd = resolve(process.cwd());
      const checks: CheckResult[] = [];

      // Node
      const nodeMajor = Number(process.versions.node.split(".")[0]);
      checks.push({
        name: "Node.js",
        status: nodeMajor >= 22 ? "ok" : "fail",
        detail: `v${process.versions.node}${nodeMajor >= 22 ? "" : " (need >=22)"}`,
      });

      // Git
      try {
        const { execSync } = await import("node:child_process");
        const version = execSync("git --version", { encoding: "utf8" }).trim();
        const isRepo = existsSync(resolve(cwd, ".git"));
        checks.push({
          name: "Git",
          status: "ok",
          detail: `${version}; repo=${isRepo ? "yes" : "no"}`,
        });
      } catch {
        checks.push({ name: "Git", status: "fail", detail: "git not found" });
      }

      // Config
      const hasConfig = existsSync(resolve(cwd, "forge.config.json"));
      checks.push({
        name: "forge.config.json",
        status: hasConfig ? "ok" : "warn",
        detail: hasConfig ? "present" : "missing (run forge init)",
      });

      let config;
      try {
        config = loadConfig(cwd);
        checks.push({
          name: "Configuration",
          status: "ok",
          detail: `mode=${config.mode}; localModel=${config.local.model || "(unset)"}; cloudModel=${config.cloud.model || "(unset)"}`,
        });
      } catch (err) {
        checks.push({
          name: "Configuration",
          status: "fail",
          detail: err instanceof Error ? err.message : String(err),
        });
        printReport(checks);
        process.exitCode = 1;
        return;
      }

      // Database
      try {
        const store = new SqliteStore(config.dbPath);
        store.initialize();
        store.close();
        checks.push({
          name: "Database",
          status: "ok",
          detail: config.dbPath,
        });
      } catch (err) {
        checks.push({
          name: "Database",
          status: "fail",
          detail: err instanceof Error ? err.message : String(err),
        });
      }

      // Ollama
      const ollama = new OllamaProvider({ baseUrl: config.ollamaBaseUrl });
      const ping = await ollama.ping();
      if (ping.ok) {
        const models = await ollama.listModels();
        checks.push({
          name: "Ollama",
          status: config.local.model ? "ok" : "warn",
          detail: `${ping.detail}; configured=${config.local.model || "(none)"}; available=${models.slice(0, 8).join(", ") || "(none)"}`,
        });
      } else {
        checks.push({
          name: "Ollama",
          status: config.mode === "local-only" ? "fail" : "warn",
          detail: `${config.ollamaBaseUrl} — ${ping.detail}`,
        });
      }

      // OpenRouter
      if (config.openRouterApiKey) {
        const or = new OpenRouterProvider({ apiKey: config.openRouterApiKey });
        const orPing = await or.ping();
        checks.push({
          name: "OpenRouter",
          status: orPing.ok ? "ok" : "warn",
          detail: `${orPing.detail}; model=${config.cloud.model || "(unset)"}`,
        });
      } else {
        checks.push({
          name: "OpenRouter",
          status: config.mode === "cloud-allowed" ? "warn" : "ok",
          detail: "API key not set (local-only operation available)",
        });
      }

      // Docker sandbox
      const { isDockerAvailable } = await import("../../tools/sandbox.js");
      const dockerOk = await isDockerAvailable();
      checks.push({
        name: "Docker sandbox",
        status:
          config.commands.sandbox === "docker" && !dockerOk
            ? "fail"
            : dockerOk
              ? "ok"
              : "warn",
        detail: dockerOk
          ? `available; mode=${config.commands.sandbox}; image=${config.commands.dockerImage}`
          : `unavailable; mode=${config.commands.sandbox} (host execution used when auto)`,
      });

      // Optional interaction gateway / channels (warn only — never fail overall for disabled channels)
      try {
        const gw = await fetch("http://127.0.0.1:8787/api/health", {
          signal: AbortSignal.timeout(800),
        });
        checks.push({
          name: "Gateway API",
          status: gw.ok ? "ok" : "warn",
          detail: gw.ok
            ? "http://127.0.0.1:8787 healthy"
            : `responded ${gw.status}`,
        });
      } catch {
        checks.push({
          name: "Gateway API",
          status: "warn",
          detail: "not running (forge-harness gateway start)",
        });
      }
      checks.push({
        name: "Telegram",
        status: process.env.TELEGRAM_BOT_TOKEN ? "ok" : "warn",
        detail: process.env.TELEGRAM_BOT_TOKEN
          ? "token set (value hidden)"
          : "disabled (optional)",
      });
      checks.push({
        name: "Slack",
        status: process.env.SLACK_BOT_TOKEN ? "ok" : "warn",
        detail: process.env.SLACK_BOT_TOKEN
          ? "token set (value hidden)"
          : "disabled (optional)",
      });
      checks.push({
        name: "WhatsApp",
        status: "warn",
        detail: "adapter stubbed (optional)",
      });

      // Verification commands
      const scripts = readPackageScripts(cwd);
      const verBits = [
        config.verification.typecheck ? "typecheck" : null,
        config.verification.lint ? "lint" : null,
        config.verification.test ? "test" : null,
        config.verification.build ? "build" : null,
        `playwright=${config.verification.playwright}`,
      ].filter(Boolean);
      checks.push({
        name: "Verification",
        status: "ok",
        detail: `enabled=[${verBits.join(", ")}]; packageScripts=[${Object.keys(scripts).join(", ") || "none"}]`,
      });

      checks.push({
        name: "Git task branches",
        status: "ok",
        detail: config.git.createTaskBranch
          ? "enabled (forge/<task-id>)"
          : "disabled",
      });

      // Permissions / workspace
      checks.push({
        name: "Workspace",
        status: "ok",
        detail: cwd,
      });

      printReport(checks);
      if (checks.some((c) => c.status === "fail")) process.exitCode = 1;
    });
}

function printReport(checks: CheckResult[]): void {
  console.log("\nForge doctor\n");
  for (const check of checks) {
    const icon = check.status === "ok" ? "OK  " : check.status === "warn" ? "WARN" : "FAIL";
    console.log(`  [${icon}] ${check.name}: ${check.detail}`);
  }
  console.log("");
}
