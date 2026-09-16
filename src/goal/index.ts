export type {
  GoalPhase,
  GoalRecord,
  CreateGoalInput,
  GoalRunResult,
} from "./types.js";
export {
  isTerminalGoalPhase,
  assertGoalPhaseTransition,
} from "./types.js";
export { GoalStore } from "./store.js";
export { GoalEngine, countCompletedNodes } from "./engine.js";
export type { GoalEngineOptions } from "./engine.js";
export { resolveGoalPlan, readGoalSpec } from "./plan.js";
