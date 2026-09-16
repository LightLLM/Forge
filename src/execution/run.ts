import type {
  ExecutionBackend,
  ExecutionRequest,
  ExecutionResult,
} from "./types.js";

/**
 * Run a command through any ExecutionBackend with create → execute → destroy.
 */
export async function runWithBackend(
  backend: ExecutionBackend,
  hostPath: string,
  req: ExecutionRequest,
  label?: string,
): Promise<ExecutionResult> {
  const workspace = await backend.createWorkspace({ hostPath, label });
  try {
    return await backend.execute(workspace, req);
  } finally {
    await backend.destroy(workspace);
  }
}
