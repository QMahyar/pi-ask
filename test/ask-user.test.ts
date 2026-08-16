import { describe, expect, it } from "vitest";
import { canShowForm, shouldLabelDecision } from "../src/ask-user.ts";

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

describe("canShowForm", () => {
  it("allows the TUI mode with a UI", () => {
    expect(canShowForm(true, "tui")).toBe(true);
  });

  it("rejects RPC even though it has a dialog-capable UI", () => {
    expect(canShowForm(true, "rpc")).toBe(false);
  });

  it("rejects print mode", () => {
    expect(canShowForm(false, "print")).toBe(false);
  });

  it("rejects json mode", () => {
    expect(canShowForm(false, "json")).toBe(false);
  });

  it("rejects the SDK default headless context (no UI context, runner default mode)", () => {
    expect(canShowForm(false, "print")).toBe(false);
  });

  it("rejects TUI mode without a UI", () => {
    expect(canShowForm(false, "tui")).toBe(false);
  });
});
