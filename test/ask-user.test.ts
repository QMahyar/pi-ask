import { describe, expect, it } from "vitest";
import { shouldLabelDecision } from "../src/ask-user.ts";

describe("shouldLabelDecision", () => {
  it("labels a successful ask_user result", () => {
    expect(shouldLabelDecision("ask_user", false)).toBe(true);
  });

  it("does not label a failed, cancelled, or aborted ask_user result", () => {
    expect(shouldLabelDecision("ask_user", true)).toBe(false);
  });

  it("does not label results for other tools", () => {
    expect(shouldLabelDecision("bash", false)).toBe(false);
    expect(shouldLabelDecision("bash", true)).toBe(false);
  });
});
