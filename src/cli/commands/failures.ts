import { resolve } from "node:path";
import type { Command } from "commander";
import { loadConfig } from "../../config/load.js";
import { FailureCorpus } from "../../failures/index.js";
import { loadDotEnv, resolveWorkspace } from "../env.js";

export function registerFailures(program: Command): void {
  const cmd = program
    .command("failures")
    .description("Structured failure corpus and retrieval");

  cmd
    .command("search")
    .description("Search failure corpus for similar symptoms")
    .argument("<query>", "Symptom or error text")
    .option("--workspace <path>", "Workspace path")
    .action((query: string, opts: { workspace?: string }) => {
      const workspace = resolve(opts.workspace ?? resolveWorkspace());
      loadDotEnv(workspace);
      const config = loadConfig(workspace);
      const corpus = new FailureCorpus(config.dbPath);
      corpus.initialize();
      const matches = corpus.search(query);
      const evidence = corpus.retrieveSolutionEvidence(query);
      corpus.close();

      if (matches.length === 0) {
        console.log("No matching failures.");
        return;
      }
      for (const m of matches) {
        console.log(`[${m.score}] ${m.entry.symptom}`);
        console.log(`  fix: ${m.entry.fix}`);
        if (m.entry.successEvidence) {
          console.log(`  evidence: ${m.entry.successEvidence}`);
        }
      }
      if (evidence) {
        console.log(`\nRetrieved solution evidence: ${evidence}`);
      }
    });
}
