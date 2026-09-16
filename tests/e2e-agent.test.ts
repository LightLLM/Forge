import { describe, expect, it, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  cpSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { SqliteStore } from "../src/persistence/sqlite.js";
import { TaskOrchestrator } from "../src/agent/orchestrator.js";
import { FakeModelProvider } from "../src/models/fake.js";
import { OllamaProvider } from "../src/models/ollama.js";
import { loadConfig } from "../src/config/load.js";
import { rootLogger } from "../src/telemetry/logger.js";
import { ForgeConfigSchema } from "../src/config/load.js";
import type { ModelProvider } from "../src/models/provider.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "..", "fixtures", "broken-app");

function setupFixtureCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), "forge-e2e-"));
  cpSync(FIXTURE, dir, { recursive: true });
  // Ensure clean broken state
  writeFileSync(
    join(dir, "src", "math.ts"),
    `export function add(a: number, b: number): number {\n  return a - b;\n}\n\nexport function greet(name: string): string {\n  return \`Hello, \${name}!\`;\n}\n`,
  );
  writeFileSync(
    join(dir, "forge.config.json"),
    JSON.stringify(
      {
        mode: "local-only",
        local: { provider: "ollama", model: "fake-model" },
        limits: { maxTurns: 10, maxRepairs: 2, timeoutMinutes: 5 },
        verification: {
          typecheck: false,
          lint: false,
          test: true,
          build: false,
          gitDiffCheck: false,
        },
      },
      null,
      2,
    ),
  );
  execSync("npm install --silent", { cwd: dir, stdio: "pipe" });
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email forge@test.local", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name Forge", { cwd: dir, stdio: "pipe" });
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync('git commit -m "fixture" --no-gpg-sign', { cwd: dir, stdio: "pipe" });
  return dir;
}

describe("agent runtime E2E (fake provider)", () => {
  let dir: string;

  afterEach(() => {
    if (dir && existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("read → edit → verify → complete", async () => {
    dir = setupFixtureCopy();

    const fake = new FakeModelProvider([
      {
        type: "tool_calls",
        toolCalls: [{ name: "read_file", arguments: { path: "src/math.ts" } }],
      },
      {
        type: "tool_calls",
        toolCalls: [
          {
            name: "apply_patch",
            arguments: {
              path: "src/math.ts",
              oldText: "return a - b;",
              newText: "return a + b;",
            },
          },
        ],
      },
      {
        type: "message",
        content: "Fixed add() to return a + b.",
      },
    ]);

    const config = loadConfig(dir, {
      mode: "local-only",
      localModel: "fake-model",
      maxTurns: 10,
      maxRepairs: 2,
    });
    // Force verification: tests only
    config.verification.typecheck = false;
    config.verification.lint = false;
    config.verification.test = true;
    config.verification.build = false;
    config.verification.gitDiffCheck = false;
    config.verification.playwright = "off";

    const store = new SqliteStore(config.dbPath);
    store.initialize();

    const orchestrator = new TaskOrchestrator({
      store,
      config,
      logger: rootLogger.child("e2e"),
      ollama: new OllamaProvider({ baseUrl: config.ollamaBaseUrl }),
      openrouter: null,
      fake,
    });

    const report = await orchestrator.run({
      objective: "Fix the add function so tests pass",
      workspacePath: dir,
    });

    expect(report.task.status).toBe("COMPLETED");
    expect(report.verification?.status).toBe("passed");
    const fixed = readFileSync(join(dir, "src", "math.ts"), "utf8");
    expect(fixed).toContain("return a + b;");
    store.close();
  }, 120_000);

  it("edit → verification failure → repair → success", async () => {
    dir = setupFixtureCopy();

    const fake = new FakeModelProvider([
      // First pass: wrong fix
      {
        type: "tool_calls",
        toolCalls: [
          {
            name: "write_file",
            arguments: {
              path: "src/math.ts",
              content:
                "export function add(a: number, b: number): number {\n  return a * b;\n}\n\nexport function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n",
            },
          },
        ],
      },
      { type: "message", content: "Changed to multiply (wrong)." },
      // Repair pass
      {
        type: "tool_calls",
        toolCalls: [
          {
            name: "apply_patch",
            arguments: {
              path: "src/math.ts",
              oldText: "return a * b;",
              newText: "return a + b;",
            },
          },
        ],
      },
      { type: "message", content: "Repaired to addition." },
    ]);

    const config = loadConfig(dir, {
      mode: "local-only",
      localModel: "fake-model",
      maxTurns: 15,
      maxRepairs: 2,
    });
    config.verification = {
      typecheck: false,
      lint: false,
      test: true,
      build: false,
      gitDiffCheck: false,
      playwright: "off",
    };

    const store = new SqliteStore(config.dbPath);
    store.initialize();
    const orchestrator = new TaskOrchestrator({
      store,
      config,
      logger: rootLogger.child("e2e-repair"),
      ollama: new OllamaProvider({ baseUrl: "http://127.0.0.1:9" }),
      openrouter: null,
      fake,
    });

    const report = await orchestrator.run({
      objective: "Fix add()",
      workspacePath: dir,
    });

    expect(report.task.status).toBe("COMPLETED");
    expect(report.task.repairCount).toBeGreaterThanOrEqual(1);
    expect(readFileSync(join(dir, "src", "math.ts"), "utf8")).toContain("a + b");
    store.close();
  }, 120_000);

  it("local failure → escalation → cloud repair", async () => {
    dir = setupFixtureCopy();

    const localFake = new FakeModelProvider([
      {
        type: "tool_calls",
        toolCalls: [
          {
            name: "write_file",
            arguments: {
              path: "src/math.ts",
              content:
                "export function add(a: number, b: number): number {\n  return 0;\n}\n\nexport function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n",
            },
          },
        ],
      },
      { type: "message", content: "Local attempt failed intentionally." },
      // local repair also wrong
      {
        type: "tool_calls",
        toolCalls: [
          {
            name: "write_file",
            arguments: {
              path: "src/math.ts",
              content:
                "export function add(a: number, b: number): number {\n  return 1;\n}\n\nexport function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n",
            },
          },
        ],
      },
      { type: "message", content: "Local repair still wrong." },
    ]);

    // Cloud provider is a separate fake used via openrouter slot
    const cloudFake = new FakeModelProvider([
      {
        type: "tool_calls",
        toolCalls: [
          {
            name: "apply_patch",
            arguments: {
              path: "src/math.ts",
              oldText: "return 1;",
              newText: "return a + b;",
            },
          },
        ],
      },
      { type: "message", content: "Cloud repair fixed add()." },
    ]);

    // Wrap cloud fake as openrouter-named provider
    const openrouterShim = {
      name: "openrouter",
      capabilities: () => cloudFake.capabilities(),
      generate: (req: Parameters<typeof cloudFake.generate>[0]) => cloudFake.generate(req),
      ping: async () => ({ ok: true, detail: "shim" }),
      listModels: async () => ["cloud-fake"],
    };

    const config = loadConfig(dir, {
      mode: "local-preferred",
      localModel: "fake-model",
      cloudModel: "cloud-fake",
      maxTurns: 20,
      maxRepairs: 1,
      maxCloudCostUsd: 1,
    });
    config.verification = {
      typecheck: false,
      lint: false,
      test: true,
      build: false,
      gitDiffCheck: false,
      playwright: "off",
    };
    config.openRouterApiKey = "test-key";

    const store = new SqliteStore(config.dbPath);
    store.initialize();

    const orchestrator = new TaskOrchestrator({
      store,
      config,
      logger: rootLogger.child("e2e-escalate"),
      ollama: new OllamaProvider({ baseUrl: "http://127.0.0.1:9" }),
      openrouter: openrouterShim,
      fake: localFake,
    });

    const report = await orchestrator.run({
      objective: "Fix add() with escalation",
      workspacePath: dir,
    });

    expect(report.escalated).toBe(true);
    expect(report.task.status).toBe("COMPLETED");
    const runs = store.listRuns(report.task.id);
    expect(runs.some((r) => r.provider === "openrouter" || r.escalationReason)).toBe(
      true,
    );
    expect(readFileSync(join(dir, "src", "math.ts"), "utf8")).toContain("a + b");
    store.close();
  }, 120_000);
});

describe("config schema", () => {
  it("applies defaults", () => {
    const cfg = ForgeConfigSchema.parse({});
    expect(cfg.mode).toBe("local-preferred");
    expect(cfg.limits.maxTurns).toBe(20);
    expect(cfg.limits.maxRepairs).toBe(2);
  });
});

describe("local-only never selects openrouter", () => {
  it("orchestrator does not call cloud in local-only", async () => {
    const dir = mkdtempSync(join(tmpdir(), "forge-local-"));
    try {
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({
          name: "t",
          private: true,
          type: "module",
          scripts: { test: "node -e \"process.exit(0)\"" },
        }),
      );
      writeFileSync(join(dir, "src", "a.ts"), "export const x = 1;\n");
      execSync("git init", { cwd: dir, stdio: "pipe" });

      let cloudCalled = false;
      const cloud: ModelProvider = {
        name: "openrouter",
        capabilities: () => ({
          provider: "openrouter",
          supportsTools: true,
          supportsStreaming: false,
          maxContextTokens: null,
          local: false,
        }),
        generate: async () => {
          cloudCalled = true;
          throw new Error("should not be called");
        },
      };

      const fake = new FakeModelProvider([
        { type: "message", content: "Nothing to do." },
      ]);

      const config = loadConfig(dir, {
        mode: "local-only",
        localModel: "fake-model",
        maxTurns: 5,
        maxRepairs: 0,
      });
      config.verification = {
        typecheck: false,
        lint: false,
        test: true,
        build: false,
        gitDiffCheck: false,
        playwright: "off",
      };
      config.openRouterApiKey = "should-not-matter";

      const store = new SqliteStore(join(dir, ".forge", "forge.db"));
      store.initialize();
      const orchestrator = new TaskOrchestrator({
        store,
        config,
        logger: rootLogger.child("local-only"),
        ollama: new OllamaProvider({ baseUrl: "http://127.0.0.1:9" }),
        openrouter: cloud,
        fake,
      });

      const report = await orchestrator.run({
        objective: "noop",
        workspacePath: dir,
      });
      expect(cloudCalled).toBe(false);
      expect(report.escalated).toBe(false);
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
