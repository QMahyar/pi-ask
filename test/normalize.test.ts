import { describe, expect, it } from "vitest";
import { AskUserValidationError, normalizeQuestionnaire } from "../src/normalize.ts";

const validParams = {
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
} as const;

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
    const bad = {
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
    const bad = {
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
    const bad = {
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