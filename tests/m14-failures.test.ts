import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FailureCorpus } from "../src/failures/index.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

function tempDb(): FailureCorpus {
  const dir = mkdtempSync(join(tmpdir(), "forge-m14-"));
  dirs.push(dir);
  const corpus = new FailureCorpus(join(dir, "forge.db"));
  corpus.initialize();
  return corpus;
}

describe("M14 failure intelligence", () => {
  it("gate: known failure retrieves previous successful solution evidence", () => {
    const corpus = tempDb();
    const entry = corpus.record({
      symptom: "typecheck failed: missing export in math.ts",
      cause: "forgot to export add function",
      fix: "export function add from math.ts",
      tags: ["typecheck", "typescript", "export"],
    });
    corpus.linkSolution(
      entry.id,
      "Added `export function add` — verification typecheck passed",
    );

    const evidence = corpus.retrieveSolutionEvidence(
      "typecheck missing export math.ts",
    );
    expect(evidence).toContain("export function add");

    const matches = corpus.search("typecheck export math");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]!.entry.id).toBe(entry.id);
    corpus.close();
  });

  it("returns fix text when no explicit success evidence", () => {
    const corpus = tempDb();
    corpus.record({
      symptom: "lint no-unused-vars helper.ts",
      fix: "remove unused import in helper.ts",
      tags: ["lint"],
    });
    const evidence = corpus.retrieveSolutionEvidence("lint unused helper");
    expect(evidence).toMatch(/remove unused import/i);
    corpus.close();
  });
});
