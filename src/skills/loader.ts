import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SkillValidator } from "./validator.js";
import type { SkillDefinition } from "./types.js";

export interface SkillLoaderOptions {
  /** Extra directories that contain skill folders. */
  extraPaths?: string[];
  /** When false, skip built-in package skills. */
  includeBuiltin?: boolean;
}

/**
 * Loads skills from Forge built-ins, workspace `skills/` / `.forge/skills/`, and config paths.
 */
export class SkillLoader {
  private readonly validator = new SkillValidator();

  load(workspacePath: string, options: SkillLoaderOptions = {}): SkillDefinition[] {
    const dirs: Array<{ path: string; source: SkillDefinition["source"] }> = [];

    if (options.includeBuiltin !== false) {
      const builtin = findBuiltinSkillsRoot();
      if (builtin) dirs.push({ path: builtin, source: "builtin" });
    }

    const workspaceSkills = join(workspacePath, "skills");
    const forgeSkills = join(workspacePath, ".forge", "skills");
    if (existsSync(workspaceSkills)) dirs.push({ path: workspaceSkills, source: "workspace" });
    if (existsSync(forgeSkills)) dirs.push({ path: forgeSkills, source: "workspace" });

    for (const p of options.extraPaths ?? []) {
      const abs = resolve(workspacePath, p);
      if (existsSync(abs)) dirs.push({ path: abs, source: "path" });
    }

    const byId = new Map<string, SkillDefinition>();
    for (const { path, source } of dirs) {
      for (const skill of this.loadDirectory(path, source)) {
        // Later sources override earlier (workspace > builtin).
        byId.set(skill.metadata.id, skill);
      }
    }
    return [...byId.values()].sort((a, b) => a.metadata.id.localeCompare(b.metadata.id));
  }

  loadDirectory(dir: string, source: SkillDefinition["source"]): SkillDefinition[] {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
    const out: SkillDefinition[] = [];
    for (const name of readdirSync(dir)) {
      const root = join(dir, name);
      if (!statSync(root).isDirectory()) continue;
      const skill = this.loadOne(root, source);
      if (skill) out.push(skill);
    }
    return out;
  }

  loadOne(rootPath: string, source: SkillDefinition["source"]): SkillDefinition | null {
    const metaPath = join(rootPath, "skill.json");
    const mdPath = join(rootPath, "SKILL.md");
    if (!existsSync(metaPath)) return null;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(metaPath, "utf8")) as unknown;
    } catch (err) {
      console.warn(
        `[forge] invalid skill.json at ${metaPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
    const validated = this.validator.validateRaw(raw);
    if (!validated.ok || !validated.metadata) {
      console.warn(
        `[forge] rejected skill at ${rootPath}: ${validated.errors.join("; ")}`,
      );
      return null;
    }
    const body = existsSync(mdPath) ? readFileSync(mdPath, "utf8") : validated.metadata.description;
    return {
      metadata: validated.metadata,
      rootPath,
      body,
      source,
    };
  }
}

export function findForgePackageRoot(
  startDir = dirname(fileURLToPath(import.meta.url)),
): string | null {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
        if (pkg.name === "forge-harness") return dir;
      } catch {
        // continue
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function findBuiltinSkillsRoot(): string | null {
  const root = findForgePackageRoot();
  if (!root) return null;
  const skills = join(root, "skills");
  return existsSync(skills) ? skills : null;
}
