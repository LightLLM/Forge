/**
 * Intentionally broken: add() returns the wrong result.
 * Forge E2E should repair this so tests pass.
 */
export function add(a: number, b: number): number {
  return a - b;
}

export function greet(name: string): string {
  return `Hello, ${name}!`;
}
