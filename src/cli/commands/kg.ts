import { resolve } from "node:path";
import type { Command } from "commander";
import { KnowledgeAnalyzer, KnowledgeQuery } from "../../knowledge/index.js";
import { loadDotEnv, resolveWorkspace } from "../env.js";

export function registerKg(program: Command): void {
  const cmd = program
    .command("kg")
    .description("Repository knowledge graph (deterministic static analysis)");

  cmd
    .command("build")
    .description("Build and summarize the knowledge graph")
    .option("--workspace <path>", "Workspace path")
    .action((opts: { workspace?: string }) => {
      const workspace = resolve(opts.workspace ?? resolveWorkspace());
      loadDotEnv(workspace);
      const graph = new KnowledgeAnalyzer().build(workspace);
      console.log(`root: ${graph.root}`);
      console.log(`files: ${graph.nodes.filter((n) => n.kind === "file").length}`);
      console.log(`edges: ${graph.edges.length}`);
      console.log(`builtAt: ${graph.builtAt}`);
    });

  cmd
    .command("deps")
    .description("Show whether from-file depends on to-file (import path)")
    .argument("<from>", "Source file (posix-relative)")
    .argument("<to>", "Target file (posix-relative)")
    .option("--workspace <path>", "Workspace path")
    .action((from: string, to: string, opts: { workspace?: string }) => {
      const workspace = resolve(opts.workspace ?? resolveWorkspace());
      loadDotEnv(workspace);
      const graph = new KnowledgeAnalyzer().build(workspace);
      const answer = new KnowledgeQuery(graph).dependsOn(from, to);
      if (!answer.found) {
        console.log(`no dependency path: ${answer.from} → ${answer.to}`);
        process.exitCode = 1;
        return;
      }
      console.log(answer.path.join(" → "));
    });

  cmd
    .command("imports")
    .description("List imports of a file")
    .argument("<file>", "Source file")
    .option("--workspace <path>", "Workspace path")
    .action((file: string, opts: { workspace?: string }) => {
      const workspace = resolve(opts.workspace ?? resolveWorkspace());
      const graph = new KnowledgeAnalyzer().build(workspace);
      const imports = new KnowledgeQuery(graph).importsOf(file);
      for (const i of imports) console.log(i);
    });
}
