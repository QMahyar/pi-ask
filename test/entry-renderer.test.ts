import { describe, expect, it } from "vitest";
import { formatAskUserEntrySummary } from "../src/ask-user.ts";

describe("formatAskUserEntrySummary", () => {
  it("formats the title and question count", () => {
    expect(formatAskUserEntrySummary({ title: "Package manager", questions: 2 })).toBe(
      "Package manager — 2 questions",
    );
  });

  it("uses the singular for a single question", () => {
    expect(formatAskUserEntrySummary({ title: "One thing", questions: 1 })).toBe(
      "One thing — 1 question",
    );
  });

  it("falls back to the entry type when the title is missing or blank", () => {
    expect(formatAskUserEntrySummary({ questions: 3 })).toBe("ask_user — 3 questions");
    expect(formatAskUserEntrySummary({ title: "   ", questions: 3 })).toBe(
      "ask_user — 3 questions",
    );
  });

  it("trims surrounding whitespace from the title", () => {
    expect(formatAskUserEntrySummary({ title: "  Title  ", questions: 4 })).toBe(
      "Title — 4 questions",
    );
  });
});
