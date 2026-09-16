import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { KnowledgeAnalyzer, KnowledgeQuery } from "../src/knowledge/index.js";

const FIXTURE = resolve("fixtures/knowledge-graph");

describe("M15 knowledge graph", () => {
  it("answers deterministic dependency questions about fixture repository", () => {
    const graph = new KnowledgeAnalyzer().build(FIXTURE);
    const q = new KnowledgeQuery(graph);

    const answer = q.dependsOn("src/SignupPage.ts", "src/UserRepository.ts");
    expect(answer.found).toBe(true);
    expect(answer.path).toEqual([
      "src/SignupPage.ts",
      "src/signupAction.ts",
      "src/AuthService.ts",
      "src/UserRepository.ts",
    ]);

    expect(q.importsOf("src/SignupPage.ts")).toContain("src/signupAction.ts");
    expect(q.importersOf("src/UserRepository.ts")).toContain("src/AuthService.ts");
    expect(q.dependsOn("src/UserRepository.ts", "src/SignupPage.ts").found).toBe(false);
  });
});
