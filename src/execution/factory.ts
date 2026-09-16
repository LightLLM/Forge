import type { SandboxOptions } from "../tools/sandbox.js";
import { ForgeError } from "../core/types.js";
import type { ExecutionBackend, ExecutionBackendMode } from "./types.js";
import { LocalExecutionBackend } from "./local.js";
import { DockerExecutionBackend, isDockerAvailable } from "./docker.js";
import { RemoteExecutionBackend, type RemoteBackendOptions } from "./remote.js";

export interface ResolveBackendOptions {
  /** Preferred mode: auto | local | docker | remote */
  mode?: ExecutionBackendMode;
  /** Legacy sandbox options (image / hardening) for Docker. */
  sandbox?: SandboxOptions;
  remote?: RemoteBackendOptions;
}

/**
 * Resolve a concrete ExecutionBackend.
 * `auto` prefers Docker when available, else local — never selects remote.
 */
export async function resolveExecutionBackend(
  options: ResolveBackendOptions = {},
): Promise<ExecutionBackend> {
  const mode = options.mode ?? "auto";
  const sandbox = options.sandbox ?? {
    mode: "host",
    image: "node:22-bookworm-slim",
    networkDisabled: true,
    hardened: true,
  };

  if (mode === "local") {
    return new LocalExecutionBackend();
  }
  if (mode === "docker") {
    const docker = new DockerExecutionBackend({
      image: sandbox.image,
      networkDisabled: sandbox.networkDisabled,
      hardened: sandbox.hardened,
      memoryLimit: sandbox.memoryLimit,
      pidsLimit: sandbox.pidsLimit,
    });
    if (!(await docker.isAvailable())) {
      throw new ForgeError(
        "Docker execution required but Docker is unavailable",
        "DOCKER_UNAVAILABLE",
      );
    }
    return docker;
  }
  if (mode === "remote") {
    return new RemoteExecutionBackend(options.remote ?? {});
  }

  // auto
  if (await isDockerAvailable()) {
    return new DockerExecutionBackend({
      image: sandbox.image,
      networkDisabled: sandbox.networkDisabled,
      hardened: sandbox.hardened,
      memoryLimit: sandbox.memoryLimit,
      pidsLimit: sandbox.pidsLimit,
    });
  }
  return new LocalExecutionBackend();
}

/** Map legacy commands.sandbox mode → execution backend mode. */
export function sandboxModeToExecutionMode(
  sandboxMode: "auto" | "host" | "docker",
): ExecutionBackendMode {
  if (sandboxMode === "host") return "local";
  return sandboxMode;
}

export function listBackendKinds(): Array<{
  kind: "local" | "docker" | "remote";
  description: string;
}> {
  return [
    { kind: "local", description: "Host process execution" },
    { kind: "docker", description: "Isolated Docker container execution" },
    {
      kind: "remote",
      description: "Vendor-neutral remote worker adapter (stub until configured)",
    },
  ];
}
