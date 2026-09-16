import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import type { KnowledgeEdge, KnowledgeGraph, KnowledgeNode } from "./types.js";

const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".forge",
  "coverage",
]);

/**
 * Deterministic static analysis: file→import relationships from TS/JS sources.
 * LLMs may enrich later; they do not replace this graph.
 */
export class KnowledgeAnalyzer {
  build(root: string): KnowledgeGraph {
    const absRoot = resolve(root);
    const files = listSourceFiles(absRoot);
    const nodes = new Map<string, KnowledgeNode>();
    const edges: KnowledgeEdge[] = [];

    for (const file of files) {
      const rel = toPosix(relative(absRoot, file));
      const id = `file:${rel}`;
      nodes.set(id, { id, kind: "file", label: rel, path: rel });

      const imports = extractImports(readFileSync(file, "utf8"));
      for (const spec of imports) {
        const resolved = resolveImport(absRoot, file, spec);
        if (!resolved) continue;
        const targetRel = toPosix(relative(absRoot, resolved));
        const targetId = `file:${targetRel}`;
        if (!nodes.has(targetId)) {
          nodes.set(targetId, {
            id: targetId,
            kind: "file",
            label: targetRel,
            path: targetRel,
          });
        }
        edges.push({ from: id, to: targetId, kind: "imports" });
      }
    }

    return {
      nodes: [...nodes.values()],
      edges,
      builtAt: new Date().toISOString(),
      root: absRoot,
    };
  }
}

function listSourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full);
      else if (st.isFile() && SOURCE_EXTS.has(extname(name))) out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

function extractImports(source: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /export\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      specs.push(m[1]!);
    }
  }
  return specs;
}

function resolveImport(root: string, fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".") && !spec.startsWith("/")) return null;
  const base = resolve(fromFile, "..", spec);
  const withoutExt = base.replace(/\.(js|jsx|mjs|cjs|ts|tsx)$/i, "");
  const candidates = [
    base,
    `${withoutExt}.ts`,
    `${withoutExt}.tsx`,
    `${withoutExt}.js`,
    `${withoutExt}.jsx`,
    join(withoutExt, "index.ts"),
    join(withoutExt, "index.js"),
  ];
  const rootLower = root.toLowerCase();
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) {
      const abs = resolve(c);
      const absLower = abs.toLowerCase();
      if (!absLower.startsWith(rootLower + sep.toLowerCase()) && absLower !== rootLower) {
        return null;
      }
      return abs;
    }
  }
  return null;
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}
