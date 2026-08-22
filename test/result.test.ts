import { describe, expect, it } from "vitest";
import { buildResult } from "../src/render/result.ts";
import type { AskUserOutcome, NormalizedQuestion, NormalizedQuestionnaire } from "../src/types.ts";

/** First text block of a tool result (content may also carry image blocks). */
function firstText(result: {
  content: Array<{ type: string; text?: string }>;
}): string | undefined {
  return result.content.find((c) => c.type === "text")?.text;
}

function choiceQuestion(
  overrides: Partial<NormalizedQuestion> & Record<string, unknown> = {},
): NormalizedQuestion {
  return {
    type: "choice",
    id: "c1",
    header: "Pick",
    prompt: "Which one?",
    multi: false,
    recommendedIndexes: [],
    options: [
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
    ],
    ...overrides,
  } as NormalizedQuestion;
}

function textQuestion(id = "t1", header = "Notes"): NormalizedQuestion {
  return { type: "text", id, header, prompt: "Anything else?" };
}

function questionnaire(
  questions: NormalizedQuestion[],
  opts: { title?: string; intro?: string } = {},
) {
  return {
    ...(opts.title !== undefined ? { title: opts.title } : {}),
    ...(opts.intro !== undefined ? { intro: opts.intro } : {}),
    questions,
  } satisfies NormalizedQuestionnaire;
}

function submittedOutcome(overrides: Partial<AskUserOutcome> = {}): AskUserOutcome {
  return {
    outcome: "submitted",
    responses: [
      {
        questionId: "c1",
        answer: {
          kind: "choice",
          answered: true,
          options: [{ value: "a", label: "Alpha", selected: true }],
        },
      },
    ],
    ...overrides,
  };
}

describe("buildResult — submitted", () => {
  it("summarizes selected answers as 'header: value'", () => {
    const result = buildResult(questionnaire([choiceQuestion()]), submittedOutcome());
    expect(result.details?.outcome).toBe("submitted");
    expect(result.content[0]?.type).toBe("text");
    expect(firstText(result)).toContain("Pick: Alpha");
  });

  it("includes the title, intro, and form comment in the details and summary", () => {
    const result = buildResult(
      questionnaire([choiceQuestion()], { title: "Deploy", intro: "Context line" }),
      submittedOutcome({ comment: "Overall note" }),
    );
    expect(result.details?.title).toBe("Deploy");
    expect(result.details?.intro).toBe("Context line");
    expect(result.details?.comment).toBe("Overall note");
    expect(firstText(result)).toContain("Form comment: Overall note");
  });

  it("omits the comment key from details when there is no form comment", () => {
    const result = buildResult(questionnaire([choiceQuestion()]), submittedOutcome());
    expect("comment" in (result.details ?? {})).toBe(false);
  });

  it("falls back to 'User submitted the form.' when there is nothing to summarize", () => {
    const result = buildResult(
      questionnaire([choiceQuestion()]),
      submittedOutcome({ responses: [] }),
    );
    expect(firstText(result)).toBe("User submitted the form.");
  });

  it("appends the question comment after the answer line", () => {
    const result = buildResult(
      questionnaire([choiceQuestion()]),
      submittedOutcome({
        responses: [
          {
            questionId: "c1",
            questionComment: "double-check",
            answer: {
              kind: "choice",
              answered: true,
              options: [{ value: "a", label: "Alpha", selected: true }],
            },
          },
        ],
      }),
    );
    expect(firstText(result)).toContain("Pick question comment: double-check");
  });

  it("lists comments on unselected options", () => {
    const result = buildResult(
      questionnaire([choiceQuestion()]),
      submittedOutcome({
        responses: [
          {
            questionId: "c1",
            answer: {
              kind: "choice",
              answered: true,
              options: [
                { value: "a", label: "Alpha", selected: true },
                { value: "b", label: "Beta", selected: false, comment: "keep in mind" },
              ],
            },
          },
        ],
      }),
    );
    const text = firstText(result);
    expect(text).toContain("Pick option comment (Beta): keep in mind");
    expect(text).not.toContain("option comment (Alpha)");
  });

  it("omits unselected options without comments entirely", () => {
    const result = buildResult(
      questionnaire([choiceQuestion()]),
      submittedOutcome({
        responses: [
          {
            questionId: "c1",
            answer: {
              kind: "choice",
              answered: true,
              options: [
                { value: "a", label: "Alpha", selected: true },
                { value: "b", label: "Beta", selected: false },
              ],
            },
          },
        ],
      }),
    );
    const text = firstText(result);
    expect(text).toContain("Pick: Alpha");
    expect(text).not.toContain("Beta");
  });

  it("falls back to the question id when a response references an unknown question", () => {
    const result = buildResult(
      questionnaire([choiceQuestion()]),
      submittedOutcome({
        responses: [
          {
            questionId: "ghost",
            answer: {
              kind: "text",
              answered: true,
              value: "free text",
            },
          },
        ],
      }),
    );
    expect(firstText(result)).toContain("ghost: free text");
  });
});

describe("buildResult — needs_discussion", () => {
  it("prepends the discussion header and unanswered list", () => {
    const result = buildResult(questionnaire([choiceQuestion(), textQuestion()]), {
      outcome: "needs_discussion",
      responses: [
        {
          questionId: "c1",
          answer: {
            kind: "choice",
            answered: true,
            options: [{ value: "a", label: "Alpha", selected: true }],
          },
        },
        {
          questionId: "t1",
          answer: { kind: "text", answered: false },
        },
      ],
    });
    const text = firstText(result);
    expect(text).toContain("User needs discussion before a complete decision.");
    expect(text).toContain("Unanswered: t1: Notes");
    expect(text).toContain("Pick: Alpha");
  });

  it("lists unanswered questions by id when their question is unknown", () => {
    const result = buildResult(questionnaire([choiceQuestion()]), {
      outcome: "needs_discussion",
      responses: [{ questionId: "ghost", answer: { kind: "text", answered: false } }],
    });
    expect(firstText(result)).toContain("Unanswered: ghost");
  });

  it("emits no unanswered line when every response is answered", () => {
    const result = buildResult(questionnaire([choiceQuestion()]), submittedOutcome());
    expect(firstText(result)).not.toContain("Unanswered:");
  });
});

describe("buildResult — truncation notices", () => {
  it("appends the first-line-exceeds notice for a single oversized line", () => {
    const huge = "x".repeat(60_000);
    const result = buildResult(questionnaire([textQuestion()]), {
      outcome: "submitted",
      responses: [{ questionId: "t1", answer: { kind: "text", answered: true, value: huge } }],
    });
    const text = firstText(result);
    expect(text).toContain("[Output truncated: first response line exceeds");
    expect(text).toContain("ask a focused follow-up for omitted text.");
  });

  it("appends the lines-exceeded notice and keeps the head of the summary", () => {
    const manyLines = Array.from({ length: 2100 }, (_, i) => `line ${i}`).join("\n");
    const result = buildResult(questionnaire([textQuestion()]), {
      outcome: "submitted",
      responses: [{ questionId: "t1", answer: { kind: "text", answered: true, value: manyLines } }],
    });
    const text = firstText(result);
    expect(text).toMatch(/\[Output truncated: showing \d+\/\d+ lines/);
    expect(text).toContain("line 0");
    expect(text).not.toContain("line 2099");
  });
});
