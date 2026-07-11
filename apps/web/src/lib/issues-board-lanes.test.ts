/// <reference types="bun" />

import { describe, expect, test } from "bun:test";

import { isLaneExpanded, toggleLaneCollapsed } from "./issues-board-lanes";

describe("isLaneExpanded", () => {
  test("treats a lane absent from the collapsed set as expanded", () => {
    expect(isLaneExpanded(new Set(), "executing")).toBe(true);
    expect(isLaneExpanded(new Set(["backlog"]), "executing")).toBe(true);
  });

  test("treats a collapsed lane as not expanded", () => {
    expect(isLaneExpanded(new Set(["executing"]), "executing")).toBe(false);
  });

  test("defaults every lane to expanded when nothing is collapsed", () => {
    const collapsed = new Set<string>();
    for (const stage of ["backlog", "ready_for_agent", "executing", "in_pr", "merged"]) {
      expect(isLaneExpanded(collapsed, stage)).toBe(true);
    }
  });
});

describe("toggleLaneCollapsed", () => {
  test("collapses an expanded lane", () => {
    const next = toggleLaneCollapsed(new Set(), "executing");
    expect(next.has("executing")).toBe(true);
    expect(isLaneExpanded(next, "executing")).toBe(false);
  });

  test("expands a collapsed lane", () => {
    const next = toggleLaneCollapsed(new Set(["executing"]), "executing");
    expect(next.has("executing")).toBe(false);
    expect(isLaneExpanded(next, "executing")).toBe(true);
  });

  test("toggling the same lane twice returns to the original state", () => {
    const start = new Set(["backlog"]);
    const roundTrip = toggleLaneCollapsed(toggleLaneCollapsed(start, "executing"), "executing");
    expect([...roundTrip].sort()).toEqual([...start].sort());
  });

  test("leaves other lanes untouched", () => {
    const next = toggleLaneCollapsed(new Set(["backlog", "merged"]), "executing");
    expect(next.has("backlog")).toBe(true);
    expect(next.has("merged")).toBe(true);
    expect(next.has("executing")).toBe(true);
  });

  test("does not mutate the input set", () => {
    const original = new Set(["backlog"]);
    toggleLaneCollapsed(original, "executing");
    expect([...original]).toEqual(["backlog"]);
  });
});
