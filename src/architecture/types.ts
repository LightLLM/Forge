export type ArchitectureRuleKind =
  | "no_import"
  | "require_import"
  | "layer_boundary";

export interface ArchitectureRule {
  id: string;
  description: string;
  kind: ArchitectureRuleKind;
  /** Glob-ish path prefix for the source side (posix). */
  from: string;
  /** Glob-ish path prefix / module pattern that must not (or must) be imported. */
  to: string;
  severity?: "error" | "warn";
}

export interface ArchitecturePolicy {
  rules: ArchitectureRule[];
}

export interface ArchitectureViolation {
  ruleId: string;
  description: string;
  fromFile: string;
  toFile: string;
}

export interface ArchitectureEvaluation {
  ok: boolean;
  violations: ArchitectureViolation[];
  rulesChecked: number;
}
