import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * DESKTOP-0 gate: architecture ADR must exist and record the Electron decision
 * before any desktop shell scaffolding (DESKTOP-1).
 */
describe("DESKTOP-0 desktop runtime ADR", () => {
  const adrPath = resolve("docs/adr/desktop-runtime.md");
  const desktopDoc = resolve("docs/desktop.md");

  it("ships desktop-runtime ADR and desktop overview", () => {
    expect(existsSync(adrPath)).toBe(true);
    expect(existsSync(desktopDoc)).toBe(true);
  });

  it("chooses Electron for this repository with explicit rationale", () => {
    const adr = readFileSync(adrPath, "utf8");
    expect(adr).toMatch(/choose Electron/i);
    expect(adr).toMatch(/Tauri 2/);
    expect(adr).toMatch(/installer size/i);
    expect(adr).toMatch(/Node integration/i);
    expect(adr).toMatch(/Playwright/);
    expect(adr).toMatch(/development complexity/i);
    expect(adr).toMatch(/vanilla/i);
    expect(adr).toMatch(/ui-html/);
  });

  it("records Electron choice and DESKTOP milestone table", () => {
    const desktop = readFileSync(desktopDoc, "utf8");
    expect(desktop).toMatch(/DESKTOP-0/);
    expect(desktop).toMatch(/Electron/);
    expect(desktop).toMatch(/DESKTOP-1.*\[✓\]/s);
  });
});
