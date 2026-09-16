import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { ForgeError } from "../core/types.js";

/**
 * Workspace boundary enforcement.
 * Every path is normalized, resolved, and verified to stay inside the assigned root.
 * Symlink targets that escape the workspace are rejected.
 */
export class Workspace {
  readonly root: string;

  constructor(workspacePath: string) {
    this.root = resolve(workspacePath);
    if (!existsSync(this.root)) {
      throw new ForgeError(`Workspace does not exist: ${this.root}`, "WORKSPACE_MISSING");
    }
  }

  /**
   * Resolve a relative (or workspace-relative) path and ensure it cannot escape.
   */
  resolveSafe(inputPath: string): string {
    if (!inputPath || typeof inputPath !== "string") {
      throw new ForgeError("Path is required", "INVALID_PATH");
    }
    if (inputPath.includes("\0")) {
      throw new ForgeError("Path contains null byte", "INVALID_PATH");
    }

    // Absolute paths are never accepted from the model.
    if (isAbsolute(inputPath)) {
      throw new ForgeError(
        `Absolute paths are not allowed: ${inputPath}`,
        "PATH_ESCAPE",
        { path: inputPath },
      );
    }

    const normalized = normalize(inputPath);
    if (normalized.startsWith("..") || normalized.split(sep).includes("..")) {
      // Still check after join — normalize alone isn't enough on all platforms.
    }

    const candidate = resolve(this.root, normalized);
    const rel = relative(this.root, candidate);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new ForgeError(
        `Path escapes workspace: ${inputPath}`,
        "PATH_ESCAPE",
        { path: inputPath, resolved: candidate },
      );
    }

    // If the path (or any parent) is a symlink, ensure the real path stays inside.
    this.assertRealPathInside(candidate);
    return candidate;
  }

  private assertRealPathInside(candidate: string): void {
    // Walk from root toward candidate; any existing symlink must resolve inside.
    const rel = relative(this.root, candidate);
    if (!rel || rel === "") return;

    const parts = rel.split(sep);
    let current = this.root;
    for (const part of parts) {
      current = join(current, part);
      if (!existsSync(current)) {
        // Non-existent leaf is OK for writes; parents must be valid.
        continue;
      }
      try {
        const real = realpathSync(current);
        const realRel = relative(this.root, real);
        if (realRel.startsWith("..") || isAbsolute(realRel)) {
          throw new ForgeError(
            `Symlink escapes workspace: ${current}`,
            "SYMLINK_ESCAPE",
            { path: current, real },
          );
        }
        // Also reject if lstat says symlink and realpath already escaped (handled above).
        void lstatSync(current);
      } catch (err) {
        if (err instanceof ForgeError) throw err;
        // realpath can fail on dangling links — treat as escape.
        throw new ForgeError(
          `Unable to validate path safely: ${current}`,
          "PATH_ESCAPE",
          { path: current, cause: String(err) },
        );
      }
    }
  }

  toRelative(absolutePath: string): string {
    const rel = relative(this.root, absolutePath);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new ForgeError("Path outside workspace", "PATH_ESCAPE");
    }
    return rel.split(sep).join("/");
  }

  readFile(relativePath: string, maxBytes = 512_000): string {
    const abs = this.resolveSafe(relativePath);
    if (!existsSync(abs)) {
      throw new ForgeError(`File not found: ${relativePath}`, "FILE_NOT_FOUND");
    }
    const st = statSync(abs);
    if (!st.isFile()) {
      throw new ForgeError(`Not a file: ${relativePath}`, "NOT_A_FILE");
    }
    if (st.size > maxBytes) {
      throw new ForgeError(
        `File too large (${st.size} bytes): ${relativePath}`,
        "FILE_TOO_LARGE",
      );
    }
    return readFileSync(abs, "utf8");
  }

  writeFile(relativePath: string, content: string): void {
    const abs = this.resolveSafe(relativePath);
    mkdirSync(dirname(abs), { recursive: true });
    // Re-validate after mkdir in case of race / symlink creation.
    this.resolveSafe(relativePath);
    writeFileSync(abs, content, "utf8");
  }

  listFiles(
    relativeDir = ".",
    options: { maxEntries?: number; extensions?: string[] } = {},
  ): string[] {
    const maxEntries = options.maxEntries ?? 500;
    const abs = this.resolveSafe(relativeDir);
    if (!existsSync(abs)) {
      throw new ForgeError(`Directory not found: ${relativeDir}`, "DIR_NOT_FOUND");
    }
    const results: string[] = [];
    const walk = (dir: string): void => {
      if (results.length >= maxEntries) return;
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (results.length >= maxEntries) return;
        if (
          entry.name === "node_modules" ||
          entry.name === ".git" ||
          entry.name === "dist" ||
          entry.name === ".forge"
        ) {
          continue;
        }
        const full = join(dir, entry.name);
        // Validate each path stays inside.
        try {
          const rel = this.toRelative(full);
          if (entry.isSymbolicLink()) {
            this.assertRealPathInside(full);
          }
          if (entry.isDirectory()) {
            walk(full);
          } else if (entry.isFile()) {
            if (
              options.extensions &&
              !options.extensions.some((ext) => entry.name.endsWith(ext))
            ) {
              continue;
            }
            results.push(rel);
          }
        } catch {
          // Skip escapes.
        }
      }
    };
    walk(abs);
    return results;
  }

  exists(relativePath: string): boolean {
    try {
      return existsSync(this.resolveSafe(relativePath));
    } catch {
      return false;
    }
  }
}
