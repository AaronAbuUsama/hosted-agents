// Collapse state for the issues board's stage lanes, mirroring the Runs table's
// collapsible groups (runs-table.tsx). Kept as pure set helpers so the board's
// component stays thin and the toggle semantics are unit-tested without a DOM.
//
// Unlike Runs — whose status groups are a fixed client-side constant it can seed
// an "expanded" set from — the board's lanes are the stages the server returns.
// So this tracks the *collapsed* lanes instead: an empty set means every lane is
// expanded, and any lane the server adds later still defaults to expanded without
// the client needing to know the full stage list up front.

// A lane is expanded unless the user has explicitly collapsed it.
export function isLaneExpanded(collapsedLanes: ReadonlySet<string>, stage: string): boolean {
  return !collapsedLanes.has(stage);
}

// Toggle one lane's collapsed state, returning a new set (never mutating the
// input) so React state updates stay referentially honest.
export function toggleLaneCollapsed(
  collapsedLanes: ReadonlySet<string>,
  stage: string,
): Set<string> {
  const next = new Set(collapsedLanes);
  if (next.has(stage)) {
    next.delete(stage);
  } else {
    next.add(stage);
  }
  return next;
}
