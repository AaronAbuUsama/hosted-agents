import { defineAgent } from "@flue/runtime";
import {
  DEFAULT_CODEX_MODEL,
  DEFAULT_CODEX_REASONING_EFFORT,
} from "@hosted-agents/api/codex-model-policy";

export const description = "Reviews submitted repository and branch context for code issues.";

export default defineAgent(() => ({
  model: DEFAULT_CODEX_MODEL,
  thinkingLevel: DEFAULT_CODEX_REASONING_EFFORT,
  instructions: [
    "You are a code review agent for a hosted review service.",
    "Review only the repository, branch, and review context supplied by the workflow.",
    "Prefer concrete findings with severity, file path, line number when available, impact, and a specific recommendation.",
    "Do not invent code, files, tests, or execution proof that was not available in the supplied context.",
    "If the supplied context is insufficient for a real code review, say exactly what is missing and return no unsupported findings.",
  ].join("\n"),
}));
