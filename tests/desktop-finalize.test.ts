import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DESKTOP_SETTINGS,
  defaultAppDataDir,
  loadDesktopSettings,
  saveDesktopSettings,
  createFileSecretStore,
  detectOllama,
  RuntimeSupervisor,
  assertCanBindLoopback,
  startInProcessRuntime,
} from "../src/desktop/index.js";

describe("DESKTOP-2..10 desktop finalize", () => {
  it("stores settings under platform app-data paths", () => {
    const dir = defaultAppDataDir("Forge-Test");
    expect(dir.toLowerCase()).toMatch(/forge-test/);
    const tmp = mkdtempSync(join(tmpdir(), "forge-settings-"));
    try {
      const s = { ...DEFAULT_DESKTOP_SETTINGS, onboardingComplete: true, workspacePath: "C:/proj" };
      saveDesktopSettings(tmp, s);
      const loaded = loadDesktopSettings(tmp);
      expect(loaded.onboardingComplete).toBe(true);
      expect(loaded.workspacePath).toBe("C:/proj");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("SecretStore set/has/get/delete without leaking via has", () => {
    const tmp = mkdtempSync(join(tmpdir(), "forge-secrets-"));
    try {
      const store = createFileSecretStore(tmp);
      expect(store.has("openrouter_api_key")).toBe(false);
      store.set("openrouter_api_key", "sk-test-secret");
      expect(store.has("openrouter_api_key")).toBe(true);
      expect(store.get("openrouter_api_key")).toBe("sk-test-secret");
      store.delete("openrouter_api_key");
      expect(store.has("openrouter_api_key")).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("supervisor restarts until max then stops", async () => {
    let starts = 0;
    const supervisor = new RuntimeSupervisor({
      maxRestarts: 2,
      restartDelayMs: 10,
      start: async () => {
        starts += 1;
        return {
          baseUrl: "http://127.0.0.1:9",
          port: 9,
          mode: "inprocess" as const,
          stop: async () => undefined,
        };
      },
    });
    await supervisor.start();
    expect(starts).toBe(1);
    await supervisor.restartAfterCrash("boom1");
    await supervisor.restartAfterCrash("boom2");
    const third = await supervisor.restartAfterCrash("boom3");
    expect(third).toBeNull();
    expect(starts).toBe(3); // initial + 2 restarts
    await supervisor.stop();
  });

  it("binds loopback and can start in-process gateway", async () => {
    await assertCanBindLoopback();
    const tmp = mkdtempSync(join(tmpdir(), "forge-runtime-"));
    try {
      const runtime = await startInProcessRuntime({ workspacePath: tmp });
      expect(runtime.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const res = await fetch(`${runtime.baseUrl}/api/system/status`);
      expect(res.ok).toBe(true);
      await runtime.stop();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("detectOllama returns structured result", async () => {
    const result = await detectOllama("http://127.0.0.1:9", { timeoutMs: 200 });
    expect(result.ok).toBe(false);
    expect(result.models).toEqual([]);
  });

  it("ships onboarding, tray-capable main, packaging config, and CI workflow", () => {
    expect(existsSync("desktop/onboarding.html")).toBe(true);
    expect(existsSync("desktop/main.mjs")).toBe(true);
    expect(existsSync(".github/workflows/desktop-release.yml")).toBe(true);
    const pkg = JSON.parse(readFileSync("desktop/package.json", "utf8"));
    expect(pkg.build.win.target).toBeTruthy();
    expect(pkg.build.mac.target).toBeTruthy();
    expect(pkg.build.linux.target).toBeTruthy();
    expect(pkg.scripts["build:win"]).toBeTruthy();
    expect(pkg.dependencies["electron-updater"] || pkg.devDependencies["electron-updater"]).toBeTruthy();
    const desktopDoc = readFileSync("docs/desktop.md", "utf8");
    expect(desktopDoc).toMatch(/DESKTOP-10.*\[✓\]/s);
  });
});
