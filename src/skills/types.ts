import { z } from "zod";

/** Keys that skills must never use to raise privileges. */
export const FORBIDDEN_SKILL_KEYS = [
  "permissions",
  "permission",
  "allowlist",
  "budget",
  "budgets",
  "routing",
  "mode",
  "secrets",
  "secret",
  "approvals",
  "approval",
  "tools",
  "mcp",
  "policy",
  "sandbox",
  "credentials",
] as const;

export const SkillMetadataSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9_-]*$/i, "skill id must be alphanumeric/underscore/hyphen"),
  name: z.string().min(1),
  description: z.string().min(1),
  version: z.string().default("1.0.0"),
  tags: z.array(z.string()).default([]),
  /** Keywords that increase selection score for a task objective. */
  triggers: z.array(z.string()).default([]),
});

export type SkillMetadata = z.infer<typeof SkillMetadataSchema>;

export interface SkillDefinition {
  metadata: SkillMetadata;
  /** Absolute path to skill directory. */
  rootPath: string;
  /** Body of SKILL.md (guidance text). */
  body: string;
  source: "builtin" | "workspace" | "path";
}

export interface SkillMatch {
  skill: SkillDefinition;
  score: number;
  reasons: string[];
}

export interface SkillRouteInput {
  objective: string;
  phase?: "implement" | "repair" | "escalate";
  /** Optional signals from package.json / workspace. */
  signals?: string[];
  maxSkills?: number;
  include?: string[];
  exclude?: string[];
}
