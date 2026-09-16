import { SkillMetadataSchema, FORBIDDEN_SKILL_KEYS, type SkillMetadata } from "./types.js";

export interface SkillValidationResult {
  ok: boolean;
  metadata?: SkillMetadata;
  errors: string[];
}

/**
 * Skills are guidance DATA. They cannot declare permissions, budgets, or routing.
 */
export class SkillValidator {
  validateRaw(raw: unknown): SkillValidationResult {
    const errors: string[] = [];
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, errors: ["skill metadata must be a JSON object"] };
    }
    const obj = raw as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      const lower = key.toLowerCase();
      if ((FORBIDDEN_SKILL_KEYS as readonly string[]).includes(lower)) {
        errors.push(
          `forbidden key '${key}': skills cannot grant permissions, budgets, routing, or tools`,
        );
      }
    }
    const parsed = SkillMetadataSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push(`${issue.path.join(".") || "metadata"}: ${issue.message}`);
      }
    }
    if (errors.length > 0) {
      return { ok: false, errors };
    }
    return { ok: true, metadata: parsed.data!, errors: [] };
  }
}
