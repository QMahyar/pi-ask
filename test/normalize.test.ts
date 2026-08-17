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

  it("rejects a non-string recommendation on a text question", () => {
    expect(() =>
      normalizeQuestionnaire({
        questions: [
          { type: "text", id: "t", header: "C", prompt: "P?", recommendation: 7 },
        ] as never,
      }),
    ).toThrow(/text question "t" recommendation must be a string, not a number/);
    expect(() =>
      normalizeQuestionnaire({
        questions: [
          { type: "text", id: "t", header: "C", prompt: "P?", recommendation: true },
        ] as never,
      }),
    ).toThrow(/text question "t" recommendation must be a string, not a boolean/);
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

  it("does not decode \\u{...}-style escapes (informational — pins current behavior)", () => {
    expect(normalizeDisplayText("\\u{1F600}")).toBe("\\u{1F600}");
    expect(normalizeDisplayText("a\\u{41}b")).toBe("a\\u{41}b");
  });

  it("strips carriage returns (raw and \\u-escaped) but keeps LF and tab", () => {
    expect(normalizeDisplayText("a\u000Db")).toBe("ab");
    expect(normalizeDisplayText("a\u000D\u000Ab")).toBe("a\nb");
    expect(normalizeDisplayText("a\\u000Db")).toBe("ab");
    expect(normalizeDisplayText("a\nb\tc")).toBe("a\nb\tc");
  });

  it("strips LRM, RLM, and ALM bidi controls (raw and \\u-escaped)", () => {
    expect(normalizeDisplayText("a\u200Eb\u200Fc\u061Cd")).toBe("abcd");
    expect(normalizeDisplayText("a\\u200Eb\\u200Fc\\u061Cd")).toBe("abcd");
  });
});

describe("question element and count validation", () => {
  it("rejects null and non-object question elements with AskUserValidationError, not a raw TypeError", () => {
    expect(() => normalizeQuestionnaire({ questions: [null] as never })).toThrow(
      AskUserValidationError,
    );
    expect(() => normalizeQuestionnaire({ questions: ["not an object"] as never })).toThrow(
      AskUserValidationError,
    );
  });

  it("rejects zero questions", () => {
    expect(() => normalizeQuestionnaire({ questions: [] })).toThrow(
      /1-10 questions only \(got 0\)/,
    );
  });

  it("rejects more than 10 questions", () => {
    const questions = Array.from({ length: 11 }, (_, i) => ({
      type: "text",
      id: `t${i}`,
      header: `H${i}`,
      prompt: `P${i}?`,
    }));
    expect(() => normalizeQuestionnaire({ questions })).toThrow(/1-10 questions only \(got 11\)/);
  });

  it("rejects duplicate question ids", () => {
    expect(() =>
      normalizeQuestionnaire({
        questions: [
          { type: "text", id: "dup", header: "A", prompt: "P1?" },
          { type: "text", id: "dup", header: "B", prompt: "P2?" },
        ],
      }),
    ).toThrow(/Duplicate question id "dup"/);
  });
});

describe("question kind validation", () => {
  it("rejects an unknown question type instead of coercing it to text", () => {
    expect(() =>
      normalizeQuestionnaire({
        questions: [{ type: "bogus", id: "c", header: "C", prompt: "P?" }] as never,
      }),
    ).toThrow(AskUserValidationError);
    expect(() =>
      normalizeQuestionnaire({
        questions: [{ type: "bogus", id: "c", header: "C", prompt: "P?" }] as never,
      }),
    ).toThrow(/Question "c" has unknown type "bogus"/);
  });

  it("rejects a case-mismatched type like TEXT", () => {
    expect(() =>
      normalizeQuestionnaire({
        questions: [{ type: "TEXT", id: "c", header: "C", prompt: "P?" }] as never,
      }),
    ).toThrow(/Question "c" has unknown type "TEXT"/);
  });

  it("rejects a non-string type", () => {
    expect(() =>
      normalizeQuestionnaire({
        questions: [{ type: 5, id: "c", header: "C", prompt: "P?" }] as never,
      }),
    ).toThrow(/Question "c" has unknown type "5"/);
  });

  it("sanitizes control characters out of the rejected type name", () => {
    expect(() =>
      normalizeQuestionnaire({
        questions: [{ type: "text\u001b[31m", id: "c", header: "C", prompt: "P?" }] as never,
      }),
    ).toThrow(/Question "c" has unknown type "text\[31m"/);
  });

  it("still accepts both supported kinds", () => {
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
        },
        { type: "text", id: "t", header: "H", prompt: "P?" },
      ],
    });
    expect(q.questions.map((question) => question.type)).toEqual(["choice", "text"]);
  });
});

describe("id, header, and prompt validation", () => {
  it("rejects an empty id", () => {
    expect(() =>
      normalizeQuestionnaire({
        questions: [{ type: "text", id: "", header: "H", prompt: "P?" }],
      }),
    ).toThrow(/Question id must be a non-empty string/);
  });

  it("rejects an empty header and an empty prompt", () => {
    expect(() =>
      normalizeQuestionnaire({
        questions: [{ type: "text", id: "t", header: "", prompt: "P?" }],
      }),
    ).toThrow('Question "t" must include a non-empty header.');
    expect(() =>
      normalizeQuestionnaire({
        questions: [{ type: "text", id: "t", header: "H", prompt: "" }],
      }),
    ).toThrow('Question "t" must include a non-empty prompt.');
  });

  it("trims whitespace around question ids", () => {
    const q = normalizeQuestionnaire({
      questions: [{ type: "text", id: "  t1  ", header: "H", prompt: "P?" }],
    });
    expect(q.questions[0]?.id).toBe("t1");
  });

  it("rejects a whitespace-only id", () => {
    expect(() =>
      normalizeQuestionnaire({
        questions: [{ type: "text", id: "   ", header: "H", prompt: "P?" }],
      }),
    ).toThrow(/Question id must be a non-empty string/);
  });
});

describe("option validation", () => {
  it("rejects 13+ options", () => {
    const options = Array.from({ length: 13 }, (_, i) => ({ value: `v${i}`, label: `L${i}` }));
    expect(() =>
      normalizeQuestionnaire({
        questions: [{ type: "choice", id: "c", header: "C", prompt: "P?", options }],
      }),
    ).toThrow(/must have 2-12 options \(got 13\)/);
  });

  it("rejects an empty option value and an empty option label", () => {
    expect(() =>
      normalizeQuestionnaire({
        questions: [
          {
            type: "choice",
            id: "c",
            header: "C",
            prompt: "P?",
            options: [
              { value: "", label: "A" },
              { value: "b", label: "B" },
            ],
          },
        ],
      }),
    ).toThrow(/option with empty value or label/);
    expect(() =>
      normalizeQuestionnaire({
        questions: [
          {
            type: "choice",
            id: "c",
            header: "C",
            prompt: "P?",
            options: [
              { value: "a", label: "   " },
              { value: "b", label: "B" },
            ],
          },
        ],
      }),
    ).toThrow(/option with empty value or label/);
  });
});

describe("recommendation shape validation", () => {
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

  it("rejects multiple recommendation entries on a single-select question", () => {
    expect(() =>
      normalizeQuestionnaire({
        questions: [{ ...choiceQuestion, recommendation: ["a", "b"] }],
      }),
    ).toThrow(/single-select question "c" recommendation must have at most 1 entry \(got 2\)/);
  });

  it("keeps one array entry valid on a single-select question", () => {
    const q = normalizeQuestionnaire({
      questions: [{ ...choiceQuestion, recommendation: ["b"] }],
    });
    const [choice] = q.questions;
    if (choice.type === "choice") {
      expect(choice.recommendedIndexes).toEqual([1]);
    }
  });

  it("keeps multiple entries valid on a multi-select question", () => {
    const q = normalizeQuestionnaire({
      questions: [{ ...choiceQuestion, multi: true, recommendation: ["a", "b"] }],
    });
    const [choice] = q.questions;
    if (choice.type === "choice") {
      expect(choice.recommendedIndexes).toEqual([0, 1]);
    }
  });

  it("rejects a plain-string recommendation on a multi-select question", () => {
    expect(() =>
      normalizeQuestionnaire({
        questions: [{ ...choiceQuestion, multi: true, recommendation: "a" }],
      }),
    ).toThrow(/multi-select question "c" recommendation must be an array, not a string/);
  });

  it("rejects duplicate recommendation values", () => {
    expect(() =>
      normalizeQuestionnaire({
        questions: [{ ...choiceQuestion, multi: true, recommendation: ["a", "a"] }],
      }),
    ).toThrow(/duplicate recommendation value "a"/);
  });

  it("rejects more than 12 recommendation entries", () => {
    const entries = Array.from({ length: 13 }, (_, i) => `v${i}`);
    expect(() =>
      normalizeQuestionnaire({
        questions: [{ ...choiceQuestion, multi: true, recommendation: entries }],
      }),
    ).toThrow(/recommendation must have at most 12 entries \(got 13\)/);
  });

  it("rejects non-string recommendation entries (e.g. numbers) with a clear error", () => {
    expect(() =>
      normalizeQuestionnaire({
        questions: [{ ...choiceQuestion, recommendation: [1] as never }],
      }),
    ).toThrow(/recommendation entries must be strings \(got number\)/);
    expect(() =>
      normalizeQuestionnaire({
        questions: [{ ...choiceQuestion, recommendation: 7 as never }],
      }),
    ).toThrow(/recommendation entries must be strings \(got number\)/);
  });
});

describe("text question with choice-only fields", () => {
  it("rejects options and multi on a text question instead of silently dropping them", () => {
    expect(() =>
      normalizeQuestionnaire({
        questions: [
          {
            type: "text",
            id: "t",
            header: "C",
            prompt: "P?",
            options: [
              { value: "a", label: "A" },
              { value: "b", label: "B" },
            ],
          },
        ] as never,
      }),
    ).toThrow(/text question "t" cannot have options or multi/);
    expect(() =>
      normalizeQuestionnaire({
        questions: [{ type: "text", id: "t", header: "C", prompt: "P?", multi: true }] as never,
      }),
    ).toThrow(/text question "t" cannot have options or multi/);
  });
});

describe("validation-error message sanitization (C1 regression)", () => {
  function messageFor(params: AskUserParams): string {
    try {
      normalizeQuestionnaire(params);
      throw new Error("expected AskUserValidationError");
    } catch (error) {
      if (error instanceof AskUserValidationError) return error.message;
      throw error;
    }
  }

  it("never leaks control characters from duplicate question ids", () => {
    const evil = "a\u001b[31m";
    const message = messageFor({
      questions: [
        { type: "text", id: evil, header: "A", prompt: "P1?" },
        { type: "text", id: evil, header: "B", prompt: "P2?" },
      ],
    });
    expect(message).toContain('Duplicate question id "a[31m"');
    expect(message).not.toContain("\u001b");
  });

  it("never leaks control characters from an oversize question id", () => {
    const evil = `${"x".repeat(99)}\u001b[31m`;
    const message = messageFor({
      questions: [{ type: "text", id: evil, header: "H", prompt: "P?" }],
    });
    expect(message).toContain('Question id "');
    expect(message).toContain("exceeds 100 characters");
    expect(message).not.toContain("\u001b");
  });

  it("never leaks control characters from duplicate option values", () => {
    const evil = "a\u001b[31m";
    const message = messageFor({
      questions: [
        {
          type: "choice",
          id: "c",
          header: "C",
          prompt: "P?",
          options: [
            { value: evil, label: "A" },
            { value: evil, label: "A again" },
          ],
        },
      ],
    });
    expect(message).toContain('duplicate option value "a[31m"');
    expect(message).not.toContain("\u001b");
  });

  it("never leaks control characters from a recommendation mismatch or the allowed-values list", () => {
    const message = messageFor({
      questions: [
        {
          type: "choice",
          id: "c",
          header: "C",
          prompt: "P?",
          options: [
            { value: "a\u001b]0;EVIL\u0007", label: "A" },
            { value: "b", label: "B" },
          ],
          recommendation: ["nope\u001b[2J\u001b[H"],
        },
      ],
    });
    expect(message).toContain('recommendation value "nope[2J[H" does not match');
    expect(message).toContain('Allowed values: ["a]0;EVIL", "b"]');
    expect(message).not.toContain("\u001b");
    expect(message).not.toContain("\u0007");
  });

  it("decodes and strips \\u-escaped control sequences in identifiers too", () => {
    const message = messageFor({
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
          recommendation: ["nope\\u001b"],
        },
      ],
    });
    expect(message).toContain('recommendation value "nope" does not match');
    expect(message).not.toContain("\u001b");
    expect(message).not.toContain("\\u001b");
  });

  it("never leaks control characters from text-question messages naming the id", () => {
    const message = messageFor({
      questions: [
        { type: "text", id: "t\u001b[31m", header: "H", prompt: "P?", multi: true },
      ] as never,
    });
    expect(message).toContain('text question "t[31m" cannot have options or multi');
    expect(message).not.toContain("\u001b");
  });
});

describe("title and intro omission", () => {
  it("omits empty or whitespace-only title and intro", () => {
    const q = normalizeQuestionnaire({
      title: "   ",
      intro: "  ",
      questions: [{ type: "text", id: "t", header: "H", prompt: "P?" }],
    });
    expect("title" in q).toBe(false);
    expect("intro" in q).toBe(false);
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

describe("exact-limit acceptance and over-long fields", () => {
  it("accepts exactly 10 questions", () => {
    const q = normalizeQuestionnaire({
      questions: Array.from({ length: 10 }, (_, i) => ({
        type: "text",
        id: `t${i}`,
        header: `H${i}`,
        prompt: "P?",
      })),
    });
    expect(q.questions).toHaveLength(10);
  });

  it("accepts exactly 12 options on a choice question", () => {
    const q = normalizeQuestionnaire({
      questions: [
        {
          type: "choice",
          id: "c",
          header: "C",
          prompt: "P?",
          options: Array.from({ length: 12 }, (_, i) => ({ value: `v${i}`, label: `L${i}` })),
        },
      ],
    });
    expect(q.questions[0]?.type).toBe("choice");
  });

  it("accepts a 100-character question id and a 60-character header", () => {
    const q = normalizeQuestionnaire({
      questions: [
        {
          type: "text",
          id: "x".repeat(100),
          header: "h".repeat(60),
          prompt: "P?",
        },
      ],
    });
    expect(q.questions[0]?.id).toHaveLength(100);
    expect(q.questions[0]?.header).toHaveLength(60);
  });

  it("accepts the maximum title, intro, prompt, and placeholder lengths", () => {
    const q = normalizeQuestionnaire({
      title: "t".repeat(120),
      intro: "i".repeat(4000),
      questions: [
        {
          type: "text",
          id: "t",
          header: "H",
          prompt: "p".repeat(4000),
          placeholder: "l".repeat(200),
        },
      ],
    });
    expect(q.title).toHaveLength(120);
    expect(q.intro).toHaveLength(4000);
    expect(q.questions[0]?.type).toBe("text");
  });

  it("rejects an over-long title (121 chars)", () => {
    expect(() =>
      normalizeQuestionnaire({
        title: "t".repeat(121),
        questions: [{ type: "text", id: "t", header: "H", prompt: "P?" }],
      }),
    ).toThrow("title exceeds 120 characters.");
  });

  it("rejects an over-long intro (4001 chars)", () => {
    expect(() =>
      normalizeQuestionnaire({
        intro: "i".repeat(4001),
        questions: [{ type: "text", id: "t", header: "H", prompt: "P?" }],
      }),
    ).toThrow("intro exceeds 4000 characters.");
  });

  it("rejects an over-long header (61 chars)", () => {
    expect(() =>
      normalizeQuestionnaire({
        questions: [{ type: "text", id: "t", header: "h".repeat(61), prompt: "P?" }],
      }),
    ).toThrow('Question "t" header exceeds 60 characters.');
  });

  it("rejects an over-long prompt (4001 chars)", () => {
    expect(() =>
      normalizeQuestionnaire({
        questions: [{ type: "text", id: "t", header: "H", prompt: "p".repeat(4001) }],
      }),
    ).toThrow('Question "t" prompt exceeds 4000 characters.');
  });

  it("rejects an over-long placeholder (201 chars)", () => {
    expect(() =>
      normalizeQuestionnaire({
        questions: [
          { type: "text", id: "t", header: "H", prompt: "P?", placeholder: "l".repeat(201) },
        ],
      }),
    ).toThrow('Question "t" placeholder exceeds 200 characters.');
  });

  it("accepts a 200-character option value and label at the boundary", () => {
    const q = normalizeQuestionnaire({
      questions: [
        {
          type: "choice",
          id: "c",
          header: "C",
          prompt: "P?",
          options: [
            { value: "v".repeat(200), label: "l".repeat(200) },
            { value: "w", label: "W" },
          ],
        },
      ],
    });
    expect(q.questions[0]?.type).toBe("choice");
  });
});
