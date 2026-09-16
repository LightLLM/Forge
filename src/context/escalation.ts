import type { VerificationResult } from "../core/types.js";
import type { Workspace } from "../workspace/workspace.js";

const PATH_IN_OUTPUT =
  /(?:^|[\s("'`]|(?:file:\/\/\/?))((?:src|lib|app|tests?|fixtures?)\/[A-Za-z0-9_./\\-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json))(?::\d+)?/gim;

const STACK_PATH =
  /\(([^()\s]+\.(?:ts|tsx|js|jsx)):(\d+):(\d+)\)/g;

/**
 * Extract likely source file paths from verification failure output,
 * then expand with shallow import closure for escalation packages.
 */
export function extractFailurePaths(verification: VerificationResult): string[] {
  const found = new Set<string>();
  for (const check of verification.checks) {
    if (check.status !== "failed") continue;
    scan(check.stdout ?? "", found);
    scan(check.stderr ?? "", found);
  }
  return [...found];
}

function scan(text: string, into: Set<string>): void {
  for (const match of text.matchAll(PATH_IN_OUTPUT)) {
    const p = (match[1] ?? "").replace(/\\/g, "/");
    if (p) into.add(p);
  }
  for (const match of text.matchAll(STACK_PATH)) {
    const p = (match[1] ?? "").replace(/\\/g, "/");
    if (p && !p.startsWith("node_modules")) into.add(p);
  }
}

/**
 * Given seed files, collect locally imported relative modules (1 hop).
 */
export function expandImportClosure(
  workspace: Workspace,
  seeds: string[],
  maxFiles = 12,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const seed of seeds) {
    if (out.length >= maxFiles) break;
    addFile(workspace, seed, seen, out);
    if (out.length >= maxFiles) break;
    try {
      const content = workspace.readFile(seed, 100_000);
      const imports = content.matchAll(
        /from\s+["'](\.[^"']+)["']|require\(\s*["'](\.[^"']+)["']\s*\)/g,
      );
      for (const m of imports) {
        if (out.length >= maxFiles) break;
        const rel = m[1] ?? m[2];
        if (!rel) continue;
        const resolved = resolveRelative(seed, rel);
        if (resolved) addFile(workspace, resolved, seen, out);
      }
    } catch {
      // ignore unreadable seeds
    }
  }
  return out;
}

function addFile(
  workspace: Workspace,
  path: string,
  seen: Set<string>,
  out: string[],
): void {
  const normalized = path.replace(/\\/g, "/");
  if (seen.has(normalized)) return;

  const candidates = expandPathCandidates(normalized);
  for (const candidate of candidates) {
    if (workspace.exists(candidate)) {
      if (seen.has(candidate)) return;
      seen.add(candidate);
      out.push(candidate);
      return;
    }
  }
}

function expandPathCandidates(path: string): string[] {
  const out = [path];
  const withoutExt = path.replace(/\.(js|jsx|mjs|cjs|ts|tsx)$/i, "");
  for (const ext of [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"]) {
    out.push(`${withoutExt}${ext}`);
    out.push(`${withoutExt}/index${ext}`);
  }
  return out;
}

function resolveRelative(fromFile: string, relImport: string): string | null {
  const fromDir = fromFile.includes("/")
    ? fromFile.slice(0, fromFile.lastIndexOf("/"))
    : ".";
  const parts = [...fromDir.split("/"), ...relImport.split("/")];
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") {
      if (stack.length === 0) return null;
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join("/");
}
