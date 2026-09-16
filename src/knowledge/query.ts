import type { DependencyAnswer, KnowledgeGraph } from "./types.js";

/**
 * Answer deterministic dependency questions over a built knowledge graph.
 */
export class KnowledgeQuery {
  constructor(private readonly graph: KnowledgeGraph) {}

  /** Shortest import path from `from` file to `to` file (posix-relative paths). */
  dependsOn(from: string, to: string): DependencyAnswer {
    const fromId = normalizeFileId(from);
    const toId = normalizeFileId(to);
    const path = bfs(this.graph, fromId, toId);
    return {
      from: stripFilePrefix(fromId),
      to: stripFilePrefix(toId),
      path: path.map(stripFilePrefix),
      found: path.length > 0,
    };
  }

  importersOf(file: string): string[] {
    const id = normalizeFileId(file);
    return this.graph.edges
      .filter((e) => e.to === id && e.kind === "imports")
      .map((e) => stripFilePrefix(e.from));
  }

  importsOf(file: string): string[] {
    const id = normalizeFileId(file);
    return this.graph.edges
      .filter((e) => e.from === id && e.kind === "imports")
      .map((e) => stripFilePrefix(e.to));
  }

  files(): string[] {
    return this.graph.nodes
      .filter((n) => n.kind === "file")
      .map((n) => n.label)
      .sort();
  }
}

function normalizeFileId(input: string): string {
  const cleaned = input.replace(/\\/g, "/").replace(/^\.\//, "");
  return cleaned.startsWith("file:") ? cleaned : `file:${cleaned}`;
}

function stripFilePrefix(id: string): string {
  return id.startsWith("file:") ? id.slice(5) : id;
}

function bfs(graph: KnowledgeGraph, from: string, to: string): string[] {
  if (from === to) return [from];
  const adj = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (e.kind !== "imports") continue;
    const list = adj.get(e.from) ?? [];
    list.push(e.to);
    adj.set(e.from, list);
  }
  const queue: string[] = [from];
  const prev = new Map<string, string | null>([[from, null]]);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of adj.get(cur) ?? []) {
      if (prev.has(next)) continue;
      prev.set(next, cur);
      if (next === to) {
        const path: string[] = [];
        let n: string | null = to;
        while (n) {
          path.unshift(n);
          n = prev.get(n) ?? null;
        }
        return path;
      }
      queue.push(next);
    }
  }
  return [];
}
