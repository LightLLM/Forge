import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Minimal .env loader — does not override existing process.env.
 * Never logs values.
 */
export function loadDotEnv(workspacePath: string): void {
  loadEnvFile(join(workspacePath, ".env"));
  loadEnvFile(join(workspacePath, ".forge", "desktop.env"));
}

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function resolveWorkspace(path?: string): string {
  return resolve(path ?? process.cwd());
}
