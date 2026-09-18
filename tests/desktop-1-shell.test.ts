import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import {
  buildStartArgs,
  pickLoopbackPort,
  resolveForgeRoot,
  resolveForgeStartCommand,
  waitForGateway,
} from "../src/desktop/sidecar.js";

describe("DESKTOP-1 Electron sidecar helpers", () => {
  it("resolves forge root above desktop/", () => {
    const root = resolveForgeRoot();
    expect(root.replace(/\\/g, "/")).toMatch(/Forge$/i);
    expect(resolveForgeStartCommand(root).args[0]).toBeTruthy();
  });

  it("builds start args bound for loopback only", () => {
    const args = buildStartArgs({
      host: "127.0.0.1",
      port: 9123,
      workspace: "C:\\Projects\\demo",
    });
    expect(args).toEqual([
      "--host",
      "127.0.0.1",
      "--port",
      "9123",
      "--workspace",
      "C:\\Projects\\demo",
    ]);
  });

  it("picks a free 127.0.0.1 port", async () => {
    const port = await pickLoopbackPort();
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThan(65536);
  });

  it("waitForGateway resolves when status endpoint is ok", async () => {
    const server = createServer((req, res) => {
      if (req.url === "/api/system/status") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    const port = await new Promise((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") reject(new Error("bad bind"));
        else resolve(addr.port);
      });
    });
    try {
      const body = await waitForGateway(`http://127.0.0.1:${port}`, {
        timeoutMs: 5_000,
      });
      expect(body.ok).toBe(true);
    } finally {
      await new Promise((r) => server.close(() => r(undefined)));
    }
  });

  it("desktop package declares Electron main entry", async () => {
    const { readFileSync, existsSync } = await import("node:fs");
    expect(existsSync("desktop/main.mjs")).toBe(true);
    expect(existsSync("desktop/preload.mjs")).toBe(true);
    expect(existsSync("desktop/loading.html")).toBe(true);
    const pkg = JSON.parse(readFileSync("desktop/package.json", "utf8"));
    expect(pkg.main).toBe("main.mjs");
    expect(pkg.devDependencies.electron).toBeTruthy();
  });
});

describe("DESKTOP-1 milestone docs", () => {
  it("marks DESKTOP-1 complete in docs/desktop.md", async () => {
    const { readFileSync } = await import("node:fs");
    const desktop = readFileSync("docs/desktop.md", "utf8");
    expect(desktop).toMatch(/DESKTOP-1.*\[✓\]/s);
    expect(desktop).toMatch(/pnpm desktop:dev/);
  });
});
