import { describe, expect, it } from "vitest";
import { AskUserValidationError, normalizeQuestionnaire } from "../src/normalize.ts";
import type { AskUserParams } from "../src/schema.ts";

const validParams: AskUserParams = {
  title: "Decide the stack",
  intro: "We need a decision before scaffolding.",
  questions: [
    {
      type: "choice",
      id: "stack",
      header: "Stack",
      prompt: "Which framework?",
      options: [
        { value: "astro", label: "Astro", description: "Static-first" },
        { value: "sveltekit", label: "SvelteKit", details: "Full SSR + adapter ecosystem" },
      ],
      recommendation: "sveltekit",
    },
    {
      type: "text",
      id: "notes",
      header: "Notes",
      prompt: "Anything else?",
      placeholder: "Optional",
    },
  ],
};

describe("normalizeQuestionnaire", () => {
  it("normalizes a valid questionnaire and resolves recommendations", () => {
    const q = normalizeQuestionnaire(validParams);
    expect(q.title).toBe("Decide the stack");
    expect(q.questions).toHaveLength(2);
    const [choice] = q.questions;
    expect(choice.type).toBe("choice");
    if (choice.type === "choice") {
      expect(choice.multi).toBe(false);
      expect(choice.recommendedIndexes).toEqual([1]);
      expect(choice.options[1]?.details).toBe("Full SSR + adapter ecosystem");
    }
  });

  it("rejects a choice question with fewer than 2 options", () => {
    const bad: AskUserParams = {
      title: "T",
      questions: [
        {
          type: "choice",
          id: "c",
          header: "C",
          prompt: "P?",
          options: [{ value: "only", label: "Only" }],
        },
      ],
    };
    expect(() => normalizeQuestionnaire(bad)).toThrow(AskUserValidationError);
  });

  it("rejects duplicate option values", () => {
    const bad: AskUserParams = {
      title: "T",
      questions: [
        {
          type: "choice",
          id: "c",
          header: "C",
          prompt: "P?",
          options: [
            { value: "a", label: "A" },
            { value: "a", label: "A again" },
          ],
        },
      ],
    };
    expect(() => normalizeQuestionnaire(bad)).toThrow(AskUserValidationError);
  });

  it("rejects a recommendation that is not an option value", () => {
    const bad: AskUserParams = {
      title: "T",
      questions: [
        {
          type: "choice",
          id: "c",
          header: "C",
          prompt: "P?",
          options: [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
          ],
          recommendation: "z",
        },
      ],
    };
    expect(() => normalizeQuestionnaire(bad)).toThrow(AskUserValidationError);
  });
});

describe("normalizeDisplayText sanitization", () => {
  it("strips ESC characters and ANSI escape text from option labels", () => {
    const rawEscLabel = "Bad\u001b[31mLabel";
    const escapeTextLabel = "Bad\\u001b[31mLabel";
    const q = normalizeQuestionnaire({
      title: "T",
      questions: [
        {
          type: "choice",
          id: "c",
          header: "C",
          prompt: "P?",
          options: [
            { value: "a", label: rawEscLabel },
            { value: "b", label: escapeTextLabel },
          ],
        },
      ],
    });
    const [choice] = q.questions;
    if (choice.type === "choice") {
      expect(choice.options[0]?.label.includes("\u001b")).toBe(false);
      expect(choice.options[1]?.label.includes("\u001b")).toBe(false);
      expect(choice.options[0]?.label).toBe("Bad[31mLabel");
      expect(choice.options[1]?.label).toBe("Bad[31mLabel");
    }
  });

  it("keeps newlines in headers", () => {
    const q = normalizeQuestionnaire({
      title: "T",
      questions: [
        {
          type: "choice",
          id: "c",
          header: "Line1\nLine2",
          prompt: "P?",
          options: [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
          ],
        },
      ],
    });
    const [choice] = q.questions;
    if (choice.type === "choice") {
      expect(choice.header).toBe("Line1\nLine2");
    }
  });

  it("keeps tabs in prompts", () => {
    const q = normalizeQuestionnaire({
      title: "T",
      questions: [
        {
          type: "choice",
          id: "c",
          header: "C",
          prompt: "a\tb",
          options: [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
          ],
        },
      ],
    });
    const [choice] = q.questions;
    if (choice.type === "choice") {
      expect(choice.prompt).toBe("a\tb");
    }
  });

  it("replaces lone surrogates with U+FFFD", () => {
    const q = normalizeQuestionnaire({
      title: "T",
      questions: [
        {
          type: "choice",
          id: "c",
          header: "C",
          prompt: "P?",
          options: [
            { value: "a", label: "A\uD83D lone" },
            { value: "b", label: "B" },
          ],
        },
      ],
    });
    const [choice] = q.questions;
    if (choice.type === "choice") {
      expect(choice.options[0]?.label.includes("\uD83D")).toBe(false);
      expect(choice.options[0]?.label).toContain("\uFFFD");
      expect(choice.options[0]?.label).toBe("A\uFFFD lone");
    }
  });
});
