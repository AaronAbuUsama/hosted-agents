// GitHub events that queue a reviewer run. Editing these is a later
// schema/planner change — surfaces render them read-only for now.
export const TRIGGER_EVENTS = [
  "PR opened",
  "PR reopened",
  "PR synchronized",
  "PR ready for review",
  "Manual request",
];
