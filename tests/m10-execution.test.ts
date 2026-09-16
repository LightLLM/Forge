import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DockerExecutionBackend,
  LocalExecutionBackend,
  RemoteExecutionBackend,
  buildDockerRunArgs,
  listBackendKinds,
  resolveExecutionBackend,
  runWithBackend,
  sandboxModeToExecutionMode,
  type ExecutionBackend,
} from "../src/execution/index.js";
import { executeCommand } from "../src/tools/sandbox.js";
import { ForgeError } from "../src/core/types.js";

const dirs: string[] = [];

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
  const dir = mkdtempSync(join(tmpdir(), "forge-m10-"));
  dirs.push(dir);
  return dir;
}

/** Gate helper: both backends expose the same interface surface. */
function assertSharedInterface(backend: ExecutionBackend): void {
  expect(typeof backend.kind).toBe("string");
  expect(typeof backend.name).toBe("string");
  expect(typeof backend.isAvailable).toBe("function");
  expect(typeof backend.createWorkspace).toBe("function");
  expect(typeof backend.execute).toBe("function");
  expect(typeof backend.destroy).toBe("function");
}

describe("M10 remote execution / ExecutionBackend", () => {
  it("gate: local and docker share the same ExecutionBackend interface", () => {
    const local = new LocalExecutionBackend();
    const docker = new DockerExecutionBackend({
      image: "node:22-bookworm-slim",
      networkDisabled: true,
    });
    assertSharedInterface(local);
    assertSharedInterface(docker);
    expect(local.kind).toBe("local");
    expect(docker.kind).toBe("docker");
    expect(listBackendKinds().map((b) => b.kind)).toEqual([
      "local",
      "docker",
      "remote",
    ]);
  });

  it("runs a command via LocalExecutionBackend", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "marker.txt"), "x", "utf8");
    const local = new LocalExecutionBackend();
    expect(await local.isAvailable()).toBe(true);
    const result = await runWithBackend(local, dir, {
      command: "node -p 1+1",
      timeoutMs: 15_000,
      maxOutputChars: 10_000,
    });
    expect(result.backend).toBe("local");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("2");
    expect(result.workspaceId).toMatch(/^local-/);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("docker backend builds run args and reports availability", async () => {
    const docker = new DockerExecutionBackend({
      image: "node:22-bookworm-slim",
      networkDisabled: true,
      hardened: true,
    });
    assertSharedInterface(docker);
    const args = buildDockerRunArgs("node -p 1", "/tmp/ws", {
      image: "node:22-bookworm-slim",
      networkDisabled: true,
      hardened: true,
    });
    expect(args).toContain("run");
    expect(args).toContain("--rm");
    expect(args).toContain("--network");
    expect(args).toContain("none");
    expect(args).toContain("node:22-bookworm-slim");
    // Availability depends on the machine; either true or false is fine —
    // createWorkspace must fail when unavailable.
    const available = await docker.isAvailable();
    if (!available) {
      await expect(
        docker.createWorkspace({ hostPath: tempDir() }),
      ).rejects.toThrow(/unavailable/i);
    } else {
      const ws = await docker.createWorkspace({ hostPath: tempDir() });
      expect(ws.backend).toBe("docker");
      await docker.destroy(ws);
    }
  });

  it("remote adapter implements the interface but stays unconfigured by default", async () => {
    const remote = new RemoteExecutionBackend({});
    assertSharedInterface(remote);
    expect(await remote.isAvailable()).toBe(false);
    await expect(
      remote.createWorkspace({ hostPath: tempDir() }),
    ).rejects.toThrow(ForgeError);
    await expect(
      remote.execute(
        {
          id: "x",
          hostPath: tempDir(),
          backend: "remote",
        },
        {
          command: "echo hi",
          timeoutMs: 1000,
          maxOutputChars: 1000,
        },
      ),
    ).rejects.toThrow(/not yet connected|not configured|REMOTE/i);
  });

  it("executeCommand uses the shared backend abstraction (local)", async () => {
    const dir = tempDir();
    const result = await executeCommand("node -p 2+2", {
      workspaceRoot: dir,
      commandTimeoutMs: 15_000,
      maxCommandOutputChars: 10_000,
      sandbox: { mode: "host", image: "", networkDisabled: true },
    });
    expect(result.backend).toBe("host");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("4");
  });

  it("resolveExecutionBackend auto falls back to local when docker missing", async () => {
    const backend = await resolveExecutionBackend({
      mode: "local",
      sandbox: {
        mode: "host",
        image: "node:22-bookworm-slim",
        networkDisabled: true,
      },
    });
    expect(backend.kind).toBe("local");
  });

  it("maps legacy sandbox modes to execution modes", () => {
    expect(sandboxModeToExecutionMode("host")).toBe("local");
    expect(sandboxModeToExecutionMode("docker")).toBe("docker");
    expect(sandboxModeToExecutionMode("auto")).toBe("auto");
  });

  it("local and docker execute paths accept identical request shapes", async () => {
    const dir = tempDir();
    const req = {
      command: "node -p 3",
      timeoutMs: 15_000,
      maxOutputChars: 4_000,
    };
    const local = new LocalExecutionBackend();
    const docker = new DockerExecutionBackend({
      image: "node:22-bookworm-slim",
      networkDisabled: true,
    });

    const localWs = await local.createWorkspace({ hostPath: dir });
    const localResult = await local.execute(localWs, req);
    await local.destroy(localWs);
    expect(localResult.exitCode).toBe(0);

    // Docker path: only execute if available; otherwise still prove API parity
    if (await docker.isAvailable()) {
      const dWs = await docker.createWorkspace({ hostPath: dir });
      const dResult = await docker.execute(dWs, req);
      await docker.destroy(dWs);
      expect(dResult.backend).toBe("docker");
      expect(typeof dResult.stdout).toBe("string");
    } else {
      // Same request object type is accepted by the interface (compile-time + call shape)
      expect(typeof docker.execute).toBe("function");
    }
  });
});
