import { describe, expect, test } from "bun:test";

import {
  DEFAULT_CODEX_MODEL,
  DEFAULT_CODEX_MODEL_ID,
  DEFAULT_CODEX_REASONING_EFFORT,
  REASONING_EFFORTS,
  isReasoningEffort,
  resolveReasoningEffort,
} from "./codex-model-policy";

describe("codex model policy", () => {
  test("default model resolves to the closest supported Codex slug at lowest reasoning", () => {
    // gpt-5.6-lunar is unsupported on the ChatGPT-account Codex backend (verified
    // live 2026-07-10); the pinned default is the closest supported slug.
    expect(DEFAULT_CODEX_MODEL_ID).toBe("gpt-5.5");
    expect(DEFAULT_CODEX_MODEL).toBe("openai-codex/gpt-5.5");
    expect(DEFAULT_CODEX_REASONING_EFFORT).toBe("minimal");
    expect(REASONING_EFFORTS[0]).toBe("minimal");
  });

  test("isReasoningEffort accepts the enumerated tiers and rejects others", () => {
    for (const effort of REASONING_EFFORTS) {
      expect(isReasoningEffort(effort)).toBe(true);
    }
    expect(isReasoningEffort("off")).toBe(false);
    expect(isReasoningEffort("lowest")).toBe(false);
    expect(isReasoningEffort("")).toBe(false);
  });

  test("resolveReasoningEffort falls back to the default for unset or invalid input", () => {
    expect(resolveReasoningEffort(undefined)).toBe(DEFAULT_CODEX_REASONING_EFFORT);
    expect(resolveReasoningEffort(null)).toBe(DEFAULT_CODEX_REASONING_EFFORT);
    expect(resolveReasoningEffort("")).toBe(DEFAULT_CODEX_REASONING_EFFORT);
    expect(resolveReasoningEffort("nonsense")).toBe(DEFAULT_CODEX_REASONING_EFFORT);
  });

  test("resolveReasoningEffort honors a valid override and trims whitespace", () => {
    expect(resolveReasoningEffort("high")).toBe("high");
    expect(resolveReasoningEffort("  medium  ")).toBe("medium");
    expect(resolveReasoningEffort("xhigh")).toBe("xhigh");
  });
});
