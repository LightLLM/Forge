import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { NodeExecutor } from "./types.js";

/**
 * Deterministic executor for fixture/plans that encode "write:<relpath>:<content>".
 * Used for M5 gate without requiring a live model.
 */
export function createDirectiveExecutor(workspacePath: string): NodeExecutor {
  return async ({ node }) => {
    const directive = parseWriteDirective(node.objective);
    if (!directive) {
      return {
        ok: false,
        summary: "unsupported objective",
        error: `Expected write:<path>:<content> directive, got: ${node.objective}`,
      };
    }
    const abs = join(workspacePath, directive.path);
    if (directive.path.includes("..") || directive.path.startsWith("/") || /^[A-Za-z]:/.test(directive.path)) {
      return { ok: false, summary: "path escape", error: "Path escapes workspace" };
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, directive.content, "utf8");
    return {
      ok: true,
      summary: `wrote ${directive.path}`,
      workspacePath,
    };
  };
}

/**
 * Executor that records timing for parallelism proofs.
 */
export function createInstrumentedExecutor(
  inner: NodeExecutor,
  workMs: number,
): NodeExecutor {
  return async (ctx) => {
    const started = Date.now();
    await delay(workMs);
    const result = await inner(ctx);
    return {
      ...result,
      summary: `${result.summary} (waited ${Date.now() - started}ms)`,
    };
  };
}

export function parseWriteDirective(
  objective: string,
): { path: string; content: string } | null {
  const m = /^write:([^:]+):([\s\S]+)$/.exec(objective.trim());
  if (!m) return null;
  return { path: m[1]!.trim().replace(/\\/g, "/"), content: m[2]! };
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}
