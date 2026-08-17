import type { AgentToolResult, Theme } from "@earendil-works/pi-coding-agent";
import type { Text } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { renderAskUserCall, renderAskUserResult } from "../src/render/transcript.ts";
import type { AskUserParams } from "../src/schema.ts";
import type { AskUserToolDetails } from "../src/types.ts";

// A theme stub that passes text through verbatim (no ANSI styling), so
// assertions on the rendered output can distinguish injected control bytes
// from legitimate theme styling.
const plainTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

type RenderResult = Pick<AgentToolResult<AskUserToolDetails>, "content" | "details">;

function textResult(text: string): RenderResult {
  return {
    content: [{ type: "text", text }],
    details: undefined as unknown as AskUserToolDetails,
  };
}

function renderText(text: Text): string {
  return text.render(500).join("\n");
}

describe("renderAskUserCall", () => {
  it("renders a valid call with title and headers", () => {
    const call = renderAskUserCall(
      {
        title: "Deploy",
        questions: [
          { type: "choice", id: "c", header: "Pick", prompt: "Which?", options: [] },
          { type: "text", id: "t", header: "Notes", prompt: "Anything?" },
        ],
      } as AskUserParams,
      plainTheme,
    );
    expect(renderText(call)).toContain("Deploy");
    expect(renderText(call)).toContain("Pick");
    expect(renderText(call)).toContain("Notes");
  });

  it("does not throw on a non-string title during streaming", () => {
    const call = renderAskUserCall(
      { title: 42, questions: [] } as unknown as AskUserParams,
      plainTheme,
    );
    expect(renderText(call)).toContain("ask_user");
  });

  it("does not throw on a non-string header during streaming", () => {
    const call = renderAskUserCall(
      {
        questions: [{ type: "text", id: "t", header: 42, prompt: "P?" }],
      } as unknown as AskUserParams,
      plainTheme,
    );
    const text = renderText(call);
    expect(text).toContain("ask_user");
    expect(text).not.toContain("42");
  });

  it("does not throw on null or primitive question entries", () => {
    const call = renderAskUserCall(
      { questions: [null, "junk"] } as unknown as AskUserParams,
      plainTheme,
    );
    expect(renderText(call)).toContain("ask_user");
  });

  it("does not throw on null args or incomplete args", () => {
    expect(renderText(renderAskUserCall(null as unknown as AskUserParams, plainTheme))).toContain(
      "ask_user",
    );
    expect(
      renderText(renderAskUserCall({} as AskUserParams, plainTheme, { argsComplete: false })),
    ).toContain("ask_user");
  });

  it("sanitizes control characters in streamed headers", () => {
    const call = renderAskUserCall(
      {
        questions: [{ type: "text", id: "t", header: "Bad\u001b[31mHeader", prompt: "P?" }],
      } as unknown as AskUserParams,
      plainTheme,
    );
    const text = renderText(call);
    expect(text).not.toContain("\u001b");
    expect(text).toContain("Bad[31mHeader");
  });
});

describe("renderAskUserResult collapsed layout", () => {
  const questions = [
    { type: "choice" as const, id: "c1", header: "Pick", prompt: "Which?", multi: false, recommendedIndexes: [], options: [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }] },
    { type: "text" as const, id: "t1", header: "Notes", prompt: "Anything?", recommendation: undefined, placeholder: undefined },
    { type: "text" as const, id: "t2", header: "Extra", prompt: "More?", recommendation: undefined, placeholder: undefined },
  ];

  const details: AskUserToolDetails = {
    outcome: "submitted",
    questions,
    responses: [
      { questionId: "c1", answer: { kind: "choice", answered: true, options: [{ value: "a", label: "Alpha", selected: true }] } },
      { questionId: "t1", answer: { kind: "text", answered: true, value: "first note" } },
      { questionId: "t2", answer: { kind: "text", answered: true, value: "second note" } },
    ],
  };

  it("shows the status line and caps answers at two with a meta line", () => {
    const result: RenderResult = { content: [], details };
    const text = renderText(renderAskUserResult(result, plainTheme));
    expect(text).toContain("Submitted · 3/3 answered");
    expect(text).toContain("✓ Pick: Alpha");
    expect(text).toContain("✓ Notes: first note");
    expect(text).not.toContain("second note");
    expect(text).toMatch(/1 more answer/);
    expect(text).toMatch(/to review/);
  });

  it("counts unanswered responses in the meta line", () => {
    const result: RenderResult = {
      content: [],
      details: {
        outcome: "needs_discussion",
        questions,
        responses: [
          { questionId: "c1", answer: { kind: "choice", answered: true, options: [{ value: "a", label: "Alpha", selected: true }] } },
          { questionId: "t1", answer: { kind: "text", answered: false } },
          { questionId: "t2", answer: { kind: "text", answered: false } },
        ],
      },
    };
    const text = renderText(renderAskUserResult(result, plainTheme));
    expect(text).toContain("Needs discussion · 1/3 answered");
    expect(text).toMatch(/2 unanswered/);
    expect(text).toContain("Pick: Alpha");
  });

  it("renders only status and meta when nothing is answered", () => {
    const result: RenderResult = {
      content: [],
      details: {
        outcome: "needs_discussion",
        questions,
        responses: [
          { questionId: "c1", answer: { kind: "choice", answered: false, options: [] } },
          { questionId: "t1", answer: { kind: "text", answered: false } },
        ],
      },
    };
    const text = renderText(renderAskUserResult(result, plainTheme));
    expect(text).toContain("0/2 answered");
    expect(text).toMatch(/2 unanswered/);
  });

  it("skips answer lines whose question id is unknown", () => {
    const result: RenderResult = {
      content: [],
      details: {
        outcome: "submitted",
        questions,
        responses: [
          { questionId: "ghost", answer: { kind: "text", answered: true, value: "orphan" } },
        ],
      },
    };
    const text = renderText(renderAskUserResult(result, plainTheme));
    expect(text).toContain("Submitted · 1/1 answered");
    expect(text).not.toContain("orphan");
  });
});

describe("renderAskUserResult expanded layout", () => {
  it("renders title, intro, comment, per-question blocks, and option comments", () => {
    const details: AskUserToolDetails = {
      outcome: "submitted",
      title: "Deploy plan",
      intro: "We need a decision.",
      comment: "Go with caution",
      questions: [
        { type: "choice" as const, id: "c1", header: "Pick", prompt: "Which?", multi: true, recommendedIndexes: [], options: [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }] },
        { type: "text" as const, id: "t1", header: "Notes", prompt: "Anything?", recommendation: undefined, placeholder: undefined },
      ],
      responses: [
      {
        questionId: "c1",
        answer: {
          kind: "choice",
          answered: true,
          options: [
            { value: "a", label: "Alpha", selected: true },
            { value: "b", label: "Beta", selected: false, comment: "revisit later" },
          ],
        },
        questionComment: "check the rollout",
      },
      { questionId: "t1", answer: { kind: "text", answered: true, value: "do it slowly" } },
      ],
    };
    const text = renderText(renderAskUserResult({ content: [], details }, plainTheme, { expanded: true }));
    expect(text).toContain("Deploy plan");
    expect(text).toContain("We need a decision.");
    expect(text).toContain("Comment: Go with caution");
    expect(text).toContain("Pick");
    expect(text).toContain("Which?");
    expect(text).toContain("[x] Alpha");
    expect(text).toContain("[ ] Beta (comment: revisit later)");
    expect(text).toContain("Question comment: check the rollout");
    expect(text).toContain("do it slowly");
  });

  it("renders 'Not answered' for questions without a matching response", () => {
    const details: AskUserToolDetails = {
      outcome: "needs_discussion",
      questions: [
        { type: "text" as const, id: "t1", header: "Notes", prompt: "Anything?", recommendation: undefined, placeholder: undefined },
      ],
      responses: [{ questionId: "ghost", answer: { kind: "text", answered: false } }],
    };
    const text = renderText(renderAskUserResult({ content: [], details }, plainTheme, { expanded: true }));
    expect(text).toContain("Not answered");
  });

  it("adds the unanswered count summary for needs_discussion outcomes", () => {
    const details: AskUserToolDetails = {
      outcome: "needs_discussion",
      title: "Plan",
      questions: [
        { type: "text" as const, id: "t1", header: "Notes", prompt: "Anything?", recommendation: undefined, placeholder: undefined },
        { type: "text" as const, id: "t2", header: "Extra", prompt: "More?", recommendation: undefined, placeholder: undefined },
      ],
      responses: [
        { questionId: "t1", answer: { kind: "text", answered: false } },
        { questionId: "t2", answer: { kind: "text", answered: false } },
      ],
    };
    const text = renderText(renderAskUserResult({ content: [], details }, plainTheme, { expanded: true }));
    expect(text).toContain("Needs discussion · 0/2 answered");
    expect(text).toContain("2 questions unanswered");
  });

  it("says '1 question unanswered' for a single unanswered question", () => {
    const details: AskUserToolDetails = {
      outcome: "needs_discussion",
      questions: [
        { type: "text" as const, id: "t1", header: "Notes", prompt: "Anything?", recommendation: undefined, placeholder: undefined },
        { type: "text" as const, id: "t2", header: "Extra", prompt: "More?", recommendation: undefined, placeholder: undefined },
      ],
      responses: [
        { questionId: "t1", answer: { kind: "text", answered: true, value: "ok" } },
        { questionId: "t2", answer: { kind: "text", answered: false } },
      ],
    };
    const text = renderText(renderAskUserResult({ content: [], details }, plainTheme, { expanded: true }));
    expect(text).toContain("1 question unanswered");
  });
});

describe("renderAskUserResult details guard", () => {
  it("renders the error flavor when details do not look like ask_user details", () => {
    const result: RenderResult = textResult("boom: bad payload");
    const text = renderText(renderAskUserResult(result, plainTheme));
    expect(text).toContain("boom: bad payload");
  });

  it("falls back to 'ask_user failed.' when malformed details have no text content", () => {
    const result: RenderResult = {
      content: [],
      details: { kind: "junk" } as unknown as AskUserToolDetails,
    };
    expect(renderText(renderAskUserResult(result, plainTheme))).toContain("ask_user failed.");
  });

  it("treats non-object details as malformed", () => {
    const result: RenderResult = {
      content: [{ type: "text", text: "whatever" }],
      details: null as unknown as AskUserToolDetails,
    };
    expect(renderText(renderAskUserResult(result, plainTheme))).toContain("whatever");
  });
});

describe("renderAskUserResult defense-in-depth sanitization", () => {
  it("strips control characters from error result text", () => {
    const out = renderAskUserResult(
      textResult('Duplicate question id "a\u001b[31m"'),
      plainTheme,
      {},
      { isError: true },
    );
    const text = renderText(out);
    expect(text).not.toContain("\u001b");
    expect(text).toContain('Duplicate question id "a[31m"');
  });

  it("strips OSC and clear-screen escapes from partial result text", () => {
    const out = renderAskUserResult(
      textResult("pending\u001b]0;EVIL\u0007\u001b[2J\u001b[H"),
      plainTheme,
      { isPartial: true },
    );
    const text = renderText(out);
    expect(text).not.toContain("\u001b");
    expect(text).not.toContain("\u0007");
    expect(text).toContain("pending]0;EVIL[2J[H");
  });

  it("falls back for an error result with no text content", () => {
    const out = renderAskUserResult(
      { content: [], details: undefined as unknown as AskUserToolDetails },
      plainTheme,
      {},
      { isError: true },
    );
    expect(renderText(out)).toContain("ask_user failed.");
  });
});
