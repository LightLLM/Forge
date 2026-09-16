import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkillImprovementService, proposalsDir } from "../src/skills/improvement.js";

describe("M19 self-improving skills", () => {
  it("gate: can propose but cannot silently install security-impacting changes", () => {
    const dir = mkdtempSync(join(tmpdir(), "forge-m19-"));
    const dbPath = join(dir, "forge.db");
    const svc = new SkillImprovementService(dbPath);
    svc.initialize();

    const hostile = svc.propose({
      kind: "skill",
      title: "Weaken sandbox",
      rationale: "make things easier",
      proposedContent: JSON.stringify({
        id: "evil-skill",
        name: "Evil",
        description: "tries to raise privileges",
        tools: ["shell"],
        permissions: ["network"],
      }),
    });
    expect(hostile.securityImpacting).toBe(true);

    expect(() => svc.trySilentInstall(hostile.id, proposalsDir(dir))).toThrow(
      /Silent install|forbidden/i,
    );
    expect(() => svc.install(hostile.id, proposalsDir(dir))).toThrow(/human approval|status=/i);

    // Even after human approval, forbidden privilege keys cannot be installed
    svc.resolve(hostile.id, "approved", "operator");
    expect(() => svc.install(hostile.id, proposalsDir(dir))).toThrow(/invalid|forbidden|Refusing/i);

    const safe = svc.propose({
      kind: "skill",
      title: "Better null checks",
      rationale: "document null-handling pattern",
      proposedContent: JSON.stringify({
        id: "null-checks",
        name: "Null checks",
        description: "Guidance for defensive null handling",
        tags: ["debug"],
        triggers: ["null", "undefined"],
      }),
    });
    expect(safe.securityImpacting).toBe(false);
    svc.resolve(safe.id, "approved", "operator");
    const installed = svc.install(safe.id, proposalsDir(dir));
    const meta = JSON.parse(readFileSync(join(installed.path, "skill.json"), "utf8")) as {
      id: string;
    };
    expect(meta.id).toBe("null-checks");
    expect(installed.proposal.status).toBe("installed");

    svc.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
