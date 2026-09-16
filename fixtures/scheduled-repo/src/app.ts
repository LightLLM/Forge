// Fixture source for scheduled engineering analyses (M9).
export function usedHelper(): string {
  return "ok";
}

export function unusedExport(): string {
  // TODO: remove after verifying dead-code hints
  return "unused";
}

export function another(): void {
  // FIXME: wire into main when ready
  usedHelper();
}
