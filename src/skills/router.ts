import type { SkillMatch, SkillRouteInput } from "./types.js";
import type { SkillRegistry } from "./registry.js";

/**
 * Deterministic skill selection. Only relevant skills enter worker context.
 */
export class SkillRouter {
  constructor(private readonly registry: SkillRegistry) {}

  route(input: SkillRouteInput): SkillMatch[] {
    const max = input.maxSkills ?? 4;
    const exclude = new Set((input.exclude ?? []).map((s) => s.toLowerCase()));
    const include = new Set((input.include ?? []).map((s) => s.toLowerCase()));
    const tokens = tokenize(
      [input.objective, ...(input.signals ?? []), input.phase ?? ""].join(" "),
    );
    const tokenSet = new Set(tokens);

    const matches: SkillMatch[] = [];
    for (const skill of this.registry.list()) {
      const id = skill.metadata.id.toLowerCase();
      if (exclude.has(id)) continue;

      const reasons: string[] = [];
      let score = 0;

      if (include.has(id)) {
        score += 100;
        reasons.push("explicitly included");
      }

      for (const trigger of skill.metadata.triggers) {
        const t = trigger.toLowerCase();
        if (tokenSet.has(t) || input.objective.toLowerCase().includes(t)) {
          score += 5;
          reasons.push(`trigger:${trigger}`);
        }
      }
      for (const tag of skill.metadata.tags) {
        const t = tag.toLowerCase();
        if (tokenSet.has(t)) {
          score += 3;
          reasons.push(`tag:${tag}`);
        }
      }
      for (const signal of input.signals ?? []) {
        const s = signal.toLowerCase();
        if (
          skill.metadata.tags.some((t) => t.toLowerCase() === s) ||
          skill.metadata.triggers.some((t) => t.toLowerCase() === s)
        ) {
          score += 4;
          reasons.push(`signal:${signal}`);
        }
      }

      // Phase biases
      if (input.phase === "repair" || input.phase === "escalate") {
        if (id === "debugging" || id === "testing") {
          score += 2;
          reasons.push(`phase:${input.phase}`);
        }
      }

      if (score > 0) {
        matches.push({ skill, score, reasons: [...new Set(reasons)] });
      }
    }

    matches.sort((a, b) => b.score - a.score || a.skill.metadata.id.localeCompare(b.skill.metadata.id));
    return matches.slice(0, max);
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .filter((t) => t.length > 1);
}
