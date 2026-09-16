import { describe, expect, it } from "vitest";
import { add, greet } from "./math.js";

describe("math", () => {
  it("adds two numbers", () => {
    expect(add(2, 3)).toBe(5);
  });

  it("greets", () => {
    expect(greet("Forge")).toBe("Hello, Forge!");
  });
});
