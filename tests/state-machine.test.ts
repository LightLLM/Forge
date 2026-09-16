import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canTransition,
  isTerminalStatus,
  allowedTransitions,
} from "../src/core/state/machine.js";
import { ForgeError } from "../src/core/types.js";

describe("task state machine", () => {
  it("allows valid transitions", () => {
    expect(canTransition("CREATED", "CONTEXT_BUILDING")).toBe(true);
    expect(canTransition("CONTEXT_BUILDING", "PLANNING")).toBe(true);
    expect(canTransition("PLANNING", "READY")).toBe(true);
    expect(canTransition("READY", "IMPLEMENTING")).toBe(true);
    expect(canTransition("IMPLEMENTING", "VERIFYING")).toBe(true);
    expect(canTransition("VERIFYING", "REPAIRING")).toBe(true);
    expect(canTransition("REPAIRING", "ESCALATING")).toBe(true);
    expect(canTransition("VERIFYING", "COMPLETED")).toBe(true);
  });

  it("rejects invalid transitions", () => {
    expect(canTransition("CREATED", "COMPLETED")).toBe(false);
    expect(canTransition("COMPLETED", "IMPLEMENTING")).toBe(false);
    expect(canTransition("FAILED", "READY")).toBe(false);
    expect(() => assertTransition("CREATED", "COMPLETED")).toThrow(ForgeError);
  });

  it("marks terminal states", () => {
    expect(isTerminalStatus("COMPLETED")).toBe(true);
    expect(isTerminalStatus("FAILED")).toBe(true);
    expect(isTerminalStatus("CANCELLED")).toBe(true);
    expect(isTerminalStatus("IMPLEMENTING")).toBe(false);
  });

  it("returns allowed transitions list", () => {
    expect(allowedTransitions("COMPLETED")).toEqual([]);
    expect(allowedTransitions("CREATED")).toContain("CONTEXT_BUILDING");
  });
});
