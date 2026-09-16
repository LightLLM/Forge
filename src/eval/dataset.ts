import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { EvalDataset } from "./types.js";
import { ForgeError } from "../core/types.js";

export function loadEvalDataset(path: string): EvalDataset {
  const abs = resolve(path);
  if (!existsSync(abs)) {
    throw new ForgeError(`Eval dataset not found: ${abs}`, "EVAL_DATASET_MISSING");
  }
  const raw = JSON.parse(readFileSync(abs, "utf8")) as EvalDataset;
  if (!raw.id || !raw.models?.length || !raw.cases?.length) {
    throw new ForgeError("Invalid eval dataset", "EVAL_DATASET_INVALID");
  }
  return raw;
}

export const BUILTIN_EVAL_DATASET: EvalDataset = {
  id: "basic-fake",
  name: "Basic fake model comparison",
  models: [
    { id: "good-fake", provider: "fake", profile: "success" },
    { id: "bad-fake", provider: "fake", profile: "fail_message" },
  ],
  cases: [
    {
      id: "complete-task",
      category: "coding",
      prompt: "Fix the failing test",
      expectContent: "ok:",
    },
    {
      id: "second-case",
      category: "coding",
      prompt: "Add a helper function",
      expectContent: "ok:",
    },
  ],
};
