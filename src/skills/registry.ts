import type { SkillDefinition } from "./types.js";

export class SkillRegistry {
  private readonly byId = new Map<string, SkillDefinition>();

  constructor(skills: SkillDefinition[] = []) {
    for (const s of skills) this.byId.set(s.metadata.id, s);
  }

  register(skill: SkillDefinition): void {
    this.byId.set(skill.metadata.id, skill);
  }

  get(id: string): SkillDefinition | null {
    return this.byId.get(id) ?? null;
  }

  list(): SkillDefinition[] {
    return [...this.byId.values()].sort((a, b) =>
      a.metadata.id.localeCompare(b.metadata.id),
    );
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  size(): number {
    return this.byId.size;
  }
}
