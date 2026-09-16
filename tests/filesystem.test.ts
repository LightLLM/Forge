import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Workspace } from "../src/workspace/workspace.js";
import { ForgeError } from "../src/core/types.js";

describe("Workspace filesystem security", () => {
  let root: string;
  let workspace: Workspace;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "forge-ws-"));
    writeFileSync(join(root, "ok.txt"), "hello");
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "main.ts"), "export {}");
    workspace = new Workspace(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("allows normal relative reads", () => {
    expect(workspace.readFile("ok.txt")).toBe("hello");
    expect(workspace.readFile("src/main.ts")).toContain("export");
  });

  it("blocks ../ traversal", () => {
    expect(() => workspace.resolveSafe("../secret")).toThrow(ForgeError);
    expect(() => workspace.readFile("../ok.txt")).toThrow(ForgeError);
    expect(() => workspace.writeFile("../../outside.txt", "x")).toThrow(ForgeError);
  });

  it("blocks absolute paths", () => {
    expect(() => workspace.resolveSafe(root)).toThrow(ForgeError);
    if (process.platform === "win32") {
      expect(() => workspace.resolveSafe("C:\\\\Windows\\\\System32")).toThrow(ForgeError);
    } else {
      expect(() => workspace.resolveSafe("/etc/passwd")).toThrow(ForgeError);
    }
  });

  it("blocks symlink escape when possible", () => {
    const outside = mkdtempSync(join(tmpdir(), "forge-out-"));
    writeFileSync(join(outside, "secret.txt"), "SECRET");
    try {
      const linkPath = join(root, "escape-link");
      try {
        symlinkSync(outside, linkPath, "junction");
      } catch {
        // Some Windows environments block symlinks without admin — skip.
        return;
      }
      expect(() => workspace.readFile("escape-link/secret.txt")).toThrow(ForgeError);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("lists files without escaping", () => {
    const files = workspace.listFiles(".");
    expect(files).toContain("ok.txt");
    expect(files).toContain("src/main.ts");
  });
});
