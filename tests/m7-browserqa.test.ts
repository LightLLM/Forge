import { mkdtempSync, rmSync, mkdirSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  BrowserQaEngine,
  StubBrowserDriver,
  PlaywrightBrowserDriver,
  loadScenarioFile,
} from "../src/verification/browser/index.js";
import { VerificationEngine } from "../src/verification/engine.js";
import { Workspace } from "../src/workspace/workspace.js";

const dirs: string[] = [];
const fixtureScenario = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "web-login",
  "browserqa",
  "login-success.json",
);

afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "forge-m7-"));
  dirs.push(dir);
  return dir;
}

describe("M7 browser QA", () => {
  it("E2E gate: login fixture succeeds via stub browser interactions", async () => {
    const dir = tempDir();
    const scenario = loadScenarioFile(fixtureScenario);
    const engine = new BrowserQaEngine({
      workspaceRoot: dir,
      driver: "stub",
      artifactDir: join(dir, ".forge", "artifacts", "browserqa", scenario.id),
    });
    const result = await engine.runScenario(scenario, new StubBrowserDriver());

    expect(result.status).toBe("passed");
    expect(result.driver).toBe("stub");
    expect(result.steps.every((s) => s.ok)).toBe(true);
    expect(result.steps.some((s) => s.action.type === "click")).toBe(true);
    expect(result.steps.some((s) => s.action.type === "type")).toBe(true);
    expect(result.screenshots.length).toBeGreaterThanOrEqual(2);
    for (const shot of result.screenshots) {
      expect(existsSync(shot)).toBe(true);
    }
  });

  it("fails when credentials are wrong", async () => {
    const dir = tempDir();
    const engine = new BrowserQaEngine({ workspaceRoot: dir, driver: "stub" });
    const result = await engine.runScenario(
      {
        id: "bad-login",
        name: "bad",
        actions: [
          { type: "navigate", target: "/" },
          { type: "type", target: "#username", value: "nope" },
          { type: "type", target: "#password", value: "nope" },
          { type: "click", target: "#login-btn" },
          { type: "assertText", expected: "Login successful" },
        ],
      },
      new StubBrowserDriver(),
    );
    expect(result.status).toBe("failed");
    expect(result.summary).toMatch(/Expected text not found|failed/i);
  });

  it("loads scenarios from workspace browserqa/ and integrates with VerificationEngine", async () => {
    const dir = tempDir();
    const scenarioDir = join(dir, "browserqa");
    mkdirSync(scenarioDir, { recursive: true });
    copyFileSync(fixtureScenario, join(scenarioDir, "login-success.json"));

    const engine = new BrowserQaEngine({ workspaceRoot: dir, driver: "stub" });
    expect(engine.loadScenarios().map((s) => s.id)).toContain("login-success");

    const verification = new VerificationEngine({
      typecheck: false,
      lint: false,
      test: false,
      build: false,
      gitDiffCheck: false,
      playwright: "off",
      browserQa: "on",
      browserQaDriver: "stub",
      commandTimeoutMs: 30_000,
      maxCommandOutputChars: 10_000,
    });
    const result = await verification.verify(new Workspace(dir));
    const browserCheck = result.checks.find((c) => c.name === "browser_qa");
    expect(browserCheck?.status).toBe("passed");
    expect(result.status).toBe("passed");
  });

  it("skips browser QA when mode auto and no scenarios", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x" }), "utf8");
    const verification = new VerificationEngine({
      typecheck: false,
      lint: false,
      test: false,
      build: false,
      gitDiffCheck: false,
      playwright: "off",
      browserQa: "auto",
      commandTimeoutMs: 5_000,
      maxCommandOutputChars: 1_000,
    });
    const result = await verification.verify(new Workspace(dir));
    expect(result.checks.find((c) => c.name === "browser_qa")).toBeUndefined();
  });

  it("Playwright driver reports availability without crashing", async () => {
    const available = await PlaywrightBrowserDriver.isAvailable();
    expect(typeof available).toBe("boolean");
    if (!available) {
      const driver = new PlaywrightBrowserDriver();
      await expect(
        driver.start({
          baseUrl: "http://127.0.0.1",
          artifactDir: join(tempDir(), "arts"),
        }),
      ).rejects.toThrow(/not installed/i);
    }
  });
});
