import { describe, expect, it, beforeEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import {
  isDockerAvailable,
  resolveCommandBackend,
  resetDockerAvailabilityCache,
  executeCommand,
} from "../src/tools/sandbox.js";
import {
  extractFailurePaths,
  expandImportClosure,
} from "../src/context/escalation.js";
import { sanitizeTaskBranchName, createTaskBranch } from "../src/workspace/git.js";
import { Workspace } from "../src/workspace/workspace.js";
import { hasPlaywright } from "../src/verification/engine.js";
import { ForgeConfigSchema } from "../src/config/load.js";
import type { VerificationResult } from "../src/core/types.js";

describe("sandbox backend selection", () => {
  beforeEach(() => {
    resetDockerAvailabilityCache();
  });

  it("host mode always uses host", async () => {
    const backend = await resolveCommandBackend({
      mode: "host",
      image: "node:22-bookworm-slim",
      networkDisabled: true,
    });
    expect(backend).toBe("host");
  });

  it("auto falls back to host when docker missing or uses docker when present", async () => {
    const available = await isDockerAvailable();
    const backend = await resolveCommandBackend({
      mode: "auto",
      image: "node:22-bookworm-slim",
      networkDisabled: true,
    });
    expect(backend).toBe(available ? "docker" : "host");
  });

  it("executes allowlisted-style command on host", async () => {
    const dir = mkdtempSync(join(tmpdir(), "forge-host-"));
    try {
      writeFileSync(join(dir, "ok.txt"), "hi");
      const result = await executeCommand("node -p 1+1", {
        workspaceRoot: dir,
        commandTimeoutMs: 15_000,
        maxCommandOutputChars: 10_000,
        sandbox: { mode: "host", image: "", networkDisabled: true },
      });
      expect(result.backend).toBe("host");
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toContain("2");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("escalation packaging", () => {
  it("extracts failure paths from verification output", () => {
    const verification: VerificationResult = {
      status: "failed",
      summary: "tests failed",
      checks: [
        {
          name: "tests",
          status: "failed",
          stdout: "FAIL src/math.ts:12:3\n",
          stderr: "Error at (src/math.test.ts:5:10)",
        },
      ],
    };
    const paths = extractFailurePaths(verification);
    expect(paths).toContain("src/math.ts");
    expect(paths).toContain("src/math.test.ts");
  });

  it("expands shallow import closure", () => {
    const dir = mkdtempSync(join(tmpdir(), "forge-esc-"));
    try {
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(
        join(dir, "src", "math.ts"),
        `import { helper } from "./helper.js";\nexport const x = helper();\n`,
      );
      writeFileSync(join(dir, "src", "helper.ts"), `export function helper() { return 1; }\n`);
      const ws = new Workspace(dir);
      const closure = expandImportClosure(ws, ["src/math.ts"], 8);
      expect(closure).toContain("src/math.ts");
      expect(closure.some((p) => p.includes("helper"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("task branch helpers", () => {
  it("sanitizes branch names", () => {
    expect(sanitizeTaskBranchName("abc-123-def")).toBe("forge/abc-123-def");
    expect(sanitizeTaskBranchName("!!")).toMatch(/^forge\//);
  });

  it("creates a task branch when enabled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "forge-branch-"));
    try {
      execSync("git init", { cwd: dir, stdio: "pipe" });
      execSync("git config user.email forge@test.local", { cwd: dir, stdio: "pipe" });
      execSync("git config user.name Forge", { cwd: dir, stdio: "pipe" });
      writeFileSync(join(dir, "a.txt"), "a");
      execSync("git add -A", { cwd: dir, stdio: "pipe" });
      execSync('git commit -m init --no-gpg-sign', { cwd: dir, stdio: "pipe" });
      const ws = new Workspace(dir);
      const result = await createTaskBranch(ws, "task-abcdef12");
      expect(result.created).toBe(true);
      expect(result.branch).toMatch(/^forge\//);
      const head = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: dir,
        encoding: "utf8",
      }).trim();
      expect(head).toBe(result.branch);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("playwright detection", () => {
  it("detects playwright dependency", () => {
    expect(
      hasPlaywright({
        devDependencies: { "@playwright/test": "^1.0.0" },
      }),
    ).toBe(true);
    expect(hasPlaywright({ scripts: { e2e: "playwright test" } })).toBe(true);
    expect(hasPlaywright({ scripts: { test: "vitest" } })).toBe(false);
  });
});

describe("v0.1 config schema", () => {
  it("defaults sandbox host and playwright auto", () => {
    const cfg = ForgeConfigSchema.parse({});
    expect(cfg.commands.sandbox).toBe("host");
    expect(cfg.verification.playwright).toBe("auto");
    expect(cfg.ui.streamProgress).toBe(true);
    expect(cfg.git.createTaskBranch).toBe(false);
  });
});
