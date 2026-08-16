import { describe, expect, it } from "vitest";
import {
  AskUserValidationError,
  normalizeDisplayText,
  normalizeQuestionnaire,
} from "../src/normalize.ts";
import { formatSelectedOptions } from "../src/render/answer-format.ts";
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

  it("accepts an array recommendation on a single-select question and resolves all indexes", () => {
    const q = normalizeQuestionnaire({
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
          recommendation: ["b"],
        },
      ],
    });
    const [choice] = q.questions;
    if (choice.type === "choice") {
      expect(choice.recommendedIndexes).toEqual([1]);
    }
  });

  it("rejects duplicate question headers", () => {
    const bad: AskUserParams = {
      title: "T",
      questions: [
        {
          type: "choice",
          id: "a",
          header: "Same",
          prompt: "P1?",
          options: [
            { value: "x", label: "X" },
            { value: "y", label: "Y" },
          ],
        },
        {
          type: "text",
          id: "b",
          header: "Same",
          prompt: "P2?",
        },
      ],
    };
    expect(() => normalizeQuestionnaire(bad)).toThrow(/Duplicate question header "Same"/);
  });

  it("throws AskUserValidationError for non-object params instead of a raw TypeError", () => {
    expect(() => normalizeQuestionnaire(null as never)).toThrow(AskUserValidationError);
    expect(() => normalizeQuestionnaire(undefined as never)).toThrow(AskUserValidationError);
    expect(() => normalizeQuestionnaire("x" as never)).toThrow(AskUserValidationError);
    expect(() => normalizeQuestionnaire({} as never)).toThrow(
      '"questions" must be an array of 1-10 questions.',
    );
  });

  it("throws AskUserValidationError for a missing or non-string question id", () => {
    expect(() =>
      normalizeQuestionnaire({
        title: "T",
        questions: [
          {
            type: "text",
            header: "C",
            prompt: "P?",
          } as never,
        ],
      }),
    ).toThrow(AskUserValidationError);
    expect(() =>
      normalizeQuestionnaire({
        title: "T",
        questions: [
          {
            type: "text",
            id: 7,
            header: "C",
            prompt: "P?",
          } as never,
        ],
      }),
    ).toThrow(AskUserValidationError);
  });
});

describe("output-field rejection", () => {
  it("rejects a hallucinated needs_discussion input with a clear message", () => {
    const bad = {
      title: "T",
      needs_discussion: true,
      questions: [{ type: "text", id: "t", header: "C", prompt: "P?" }],
    } as never;
    expect(() => normalizeQuestionnaire(bad)).toThrow(
      "`needs_discussion` is an output field; the tool returns it when questions are unanswered — do not pass it.",
    );
  });

  it("rejects other output fields (outcome, responses)", () => {
    expect(() => normalizeQuestionnaire({ outcome: "submitted", questions: [] } as never)).toThrow(
      /is an output field returned by the tool/,
    );
    expect(() => normalizeQuestionnaire({ responses: [], questions: [] } as never)).toThrow(
      /is an output field returned by the tool/,
    );
  });
});

describe("deprecated-field messages", () => {
  const choiceQuestion = {
    type: "choice",
    id: "c",
    header: "C",
    prompt: "P?",
    options: [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ],
  };

  it("required on choice points at the needs_discussion outcome", () => {
    expect(() =>
      normalizeQuestionnaire({
        questions: [{ ...choiceQuestion, required: true }] as never,
      }),
    ).toThrow(/produce the "needs_discussion" outcome/);
  });

  it("allowOther on choice points at a text question", () => {
    expect(() =>
      normalizeQuestionnaire({
        questions: [{ ...choiceQuestion, allowOther: true }] as never,
      }),
    ).toThrow(/Use a separate text question for free-form input/);
  });

  it("initial on choice points at recommendation", () => {
    expect(() =>
      normalizeQuestionnaire({
        questions: [{ ...choiceQuestion, initial: "a" }] as never,
      }),
    ).toThrow(/Use "recommendation" for suggested options/);
  });

  it("required on text points at the needs_discussion outcome", () => {
    expect(() =>
      normalizeQuestionnaire({
        questions: [{ type: "text", id: "t", header: "C", prompt: "P?", required: true }] as never,
      }),
    ).toThrow(/produce the "needs_discussion" outcome/);
  });

  it("initial on text points at recommendation", () => {
    expect(() =>
      normalizeQuestionnaire({
        questions: [{ type: "text", id: "t", header: "C", prompt: "P?", initial: "x" }] as never,
      }),
    ).toThrow(/Use "recommendation" for suggested text/);
  });
});

describe("length limits", () => {
  const choiceQuestion = {
    type: "choice",
    id: "c",
    header: "C",
    prompt: "P?",
    options: [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ],
  };

  it("rejects an over-long question id naming the offending id", () => {
    const longId = "x".repeat(101);
    expect(() =>
      normalizeQuestionnaire({
        questions: [{ ...choiceQuestion, id: longId }],
      }),
    ).toThrow(`Question id "${longId}" exceeds 100 characters.`);
  });

  it("rejects over-long option values, labels, descriptions, and details", () => {
    const longValue = "a".repeat(201);
    const longLabel = "A".repeat(201);
    const longDescription = "d".repeat(1001);
    const longDetails = "d".repeat(2001);
    expect(() =>
      normalizeQuestionnaire({
        questions: [
          {
            ...choiceQuestion,
            options: [
              { value: longValue, label: "A" },
              { value: "b", label: "B" },
            ],
          },
        ],
      }),
    ).toThrow(`choice question "c" option value "${longValue}" exceeds 200 characters.`);
    expect(() =>
      normalizeQuestionnaire({
        questions: [
          {
            ...choiceQuestion,
            options: [
              { value: "a", label: longLabel },
              { value: "b", label: "B" },
            ],
          },
        ],
      }),
    ).toThrow(`choice question "c" option "a" label exceeds 200 characters.`);
    expect(() =>
      normalizeQuestionnaire({
        questions: [
          {
            ...choiceQuestion,
            options: [
              { value: "a", label: "A", description: longDescription },
              { value: "b", label: "B" },
            ],
          },
        ],
      }),
    ).toThrow(`choice question "c" option "a" description exceeds 1000 characters.`);
    expect(() =>
      normalizeQuestionnaire({
        questions: [
          {
            ...choiceQuestion,
            options: [
              { value: "a", label: "A", details: longDetails },
              { value: "b", label: "B" },
            ],
          },
        ],
      }),
    ).toThrow(`choice question "c" option "a" details exceeds 2000 characters.`);
  });

  it("rejects an over-long text recommendation naming the question", () => {
    const longRecommendation = "r".repeat(201);
    expect(() =>
      normalizeQuestionnaire({
        questions: [
          {
            type: "text",
            id: "t",
            header: "C",
            prompt: "P?",
            recommendation: longRecommendation,
          },
        ],
      }),
    ).toThrow(`Question "t" recommendation exceeds 200 characters.`);
  });

  it("rejects an over-long choice recommendation value naming the question", () => {
    const longRecommendation = "r".repeat(201);
    expect(() =>
      normalizeQuestionnaire({
        questions: [{ ...choiceQuestion, recommendation: longRecommendation }],
      }),
    ).toThrow(
      `choice question "c" recommendation value "${longRecommendation}" exceeds 200 characters.`,
    );
  });

  it("rejects an array recommendation on a text question", () => {
    expect(() =>
      normalizeQuestionnaire({
        questions: [
          { type: "text", id: "t", header: "C", prompt: "P?", recommendation: ["x"] },
        ] as never,
      }),
    ).toThrow(/text question "t" recommendation must be a string, not an array/);
  });
});

describe("normalizeDisplayText sanitization", () => {
  it("strips C1 controls (raw and \\u-escaped)", () => {
    expect(normalizeDisplayText("a\u0085b\u009Bc")).toBe("abc");
    expect(normalizeDisplayText("a\\u0085b\\u009Bc")).toBe("abc");
  });

  it("strips bidi controls (raw and \\u-escaped)", () => {
    expect(normalizeDisplayText("\u202Eevil\u202C")).toBe("evil");
    expect(normalizeDisplayText("\\u202Eevil\\u202C")).toBe("evil");
    expect(normalizeDisplayText("a\u2066b\u2069c")).toBe("abc");
  });

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

describe("formatSelectedOptions", () => {
  it("joins selected option labels with '; '", () => {
    expect(
      formatSelectedOptions([
        { label: "A", selected: true },
        { label: "B", selected: false },
        { label: "C", selected: true },
      ]),
    ).toBe("A; C");
  });

  it("appends a comment to a selected option", () => {
    expect(formatSelectedOptions([{ label: "A", selected: true, comment: "keep" }])).toBe(
      "A (comment: keep)",
    );
  });

  it("ignores comments on unselected options", () => {
    expect(
      formatSelectedOptions([{ label: "A", selected: false, comment: "hmm" }]),
    ).toBeUndefined();
  });

  it("returns undefined when nothing is selected", () => {
    expect(
      formatSelectedOptions([
        { label: "A", selected: false },
        { label: "B", selected: false },
      ]),
    ).toBeUndefined();
  });
});
