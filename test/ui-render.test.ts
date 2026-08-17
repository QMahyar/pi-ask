import type { Theme } from "@earendil-works/pi-coding-agent";
import { type EditorComponent, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { AskUserController } from "../src/session/controller.ts";
import type { NormalizedChoiceQuestion, NormalizedQuestion } from "../src/types.ts";
import { type RenderFormFrameArgs, renderFormFrame } from "../src/ui/form-render.ts";
import {
  formatSplitLine,
  padRight,
  pushWrappedWithPrefix,
  renderMiniBox,
  renderPrompt,
  safeWidth,
  wrapLines,
} from "../src/ui/form-render-primitives.ts";
import { renderReviewScreen } from "../src/ui/form-review-render.ts";
import { defaultChoiceRowIndex, focusForMode } from "../src/ui/form-view.ts";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Theme stub that records (color, text) pairs and passes text through verbatim. */
function makeTheme(): Theme & { calls: Array<[string, string]> } {
  const calls: Array<[string, string]> = [];
  const theme = {
    calls,
    fg: (color: string, text: string) => {
      calls.push([color, text]);
      return text;
    },
    bold: (text: string) => text,
  } as unknown as Theme & { calls: Array<[string, string]> };
  return theme;
}

function stubEditor(text = ""): EditorComponent {
  return {
    render: () => [`> ${text}`],
    getText: () => text,
    setText: vi.fn(),
    handleInput: vi.fn(),
  } as unknown as EditorComponent;
}

function choiceQuestion(
  overrides: Partial<NormalizedChoiceQuestion> = {},
): NormalizedChoiceQuestion {
  return {
    type: "choice",
    id: "c1",
    header: "Pick",
    prompt: "Which one?",
    multi: false,
    recommendedIndexes: [],
    options: [
      { value: "a", label: "Alpha", description: "First option" },
      { value: "b", label: "Beta" },
    ],
    ...overrides,
  };
}

function textQuestion(overrides: Partial<Extract<NormalizedQuestion, { type: "text" }>> = {}) {
  return {
    type: "text" as const,
    id: "t1",
    header: "Notes",
    prompt: "Anything else?",
    ...overrides,
  };
}

function makeController(
  questions: NormalizedQuestion[],
  opts: { title?: string; intro?: string } = {},
): AskUserController {
  return new AskUserController({
    ...(opts.title !== undefined ? { title: opts.title } : {}),
    ...(opts.intro !== undefined ? { intro: opts.intro } : {}),
    questions,
  });
}

function frameArgs(overrides: Partial<RenderFormFrameArgs> = {}): RenderFormFrameArgs {
  const controller = overrides.controller ?? makeController([choiceQuestion(), textQuestion()]);
  return {
    width: 60,
    theme: makeTheme() as unknown as Theme,
    controller,
    mode: "choice",
    focus: "choices",
    editor: stubEditor(),
    choiceFocusIndex: 0,
    reviewFocusIndex: 0,
    ...overrides,
  };
}

function renderFrame(args: RenderFormFrameArgs): { lines: string[]; text: string } {
  const { lines } = renderFormFrame(args);
  return { lines, text: lines.join("\n") };
}

// ── form-view.ts ───────────────────────────────────────────────────────────

describe("focusForMode", () => {
  it("maps each mode to its only valid focus target", () => {
    expect(focusForMode("choice")).toBe("choices");
    expect(focusForMode("review")).toBe("review");
    expect(focusForMode("text")).toBe("editor");
    expect(focusForMode("question-comment")).toBe("editor");
    expect(focusForMode("form-comment")).toBe("editor");
    expect(focusForMode("option-comment")).toBe("editor");
  });
});

describe("defaultChoiceRowIndex", () => {
  it("returns the row of the first selected option (prefill)", () => {
    const controller = makeController([choiceQuestion({ recommendedIndexes: [1] })]);
    const question = controller.currentQuestion as NormalizedChoiceQuestion;
    expect(defaultChoiceRowIndex(controller, question)).toBe(1);
  });

  it("returns 0 when no option is selected", () => {
    const controller = makeController([choiceQuestion()]);
    const question = controller.currentQuestion as NormalizedChoiceQuestion;
    expect(defaultChoiceRowIndex(controller, question)).toBe(0);
  });
});

// ── form-render-primitives.ts ──────────────────────────────────────────────

describe("safeWidth", () => {
  it("clamps widths to at least 1", () => {
    expect(safeWidth(40)).toBe(40);
    expect(safeWidth(0)).toBe(1);
    expect(safeWidth(-5)).toBe(1);
  });
});

describe("padRight", () => {
  it("pads short text to the target width", () => {
    expect(padRight("ab", 5)).toBe("ab   ");
  });

  it("truncates text wider than the target", () => {
    expect(visibleWidth(padRight("abcdef", 4))).toBeLessThanOrEqual(4);
    expect(padRight("abcdef", 4)).toContain("a");
  });

  it("never pads below one column", () => {
    // truncateToWidth collapses a too-narrow input to a single dot.
    expect(visibleWidth(padRight("ab", 0))).toBeLessThanOrEqual(1);
    expect(padRight("ab", 0)).toContain(".");
  });
});

describe("formatSplitLine", () => {
  it("left-justifies the left text and right-justifies the right text", () => {
    expect(formatSplitLine("Title", "ctx", 20)).toBe("Title            ctx");
  });

  it("falls back to a truncated single line when the pair does not fit", () => {
    const line = formatSplitLine("A very long title", "ctx", 12);
    expect(visibleWidth(line)).toBeLessThanOrEqual(12);
    expect(line).toMatch(/^A very lo/);
  });

  it("does not pad when the pieces already fill the width", () => {
    const line = formatSplitLine("12345", "67890", 12);
    expect(line).toBe("12345  67890");
  });
});

describe("wrapLines", () => {
  it("wraps a long line into several", () => {
    const wrapped = wrapLines(["aaaaaaaaaa bbbbbbbbbb ccc"], 8);
    expect(wrapped.length).toBeGreaterThan(1);
    expect(wrapped.join("").replace(/\s+/g, "")).toBe("aaaaaaaaaabbbbbbbbbbccc");
  });

  it("keeps short lines untouched", () => {
    expect(wrapLines(["hi"], 20)).toEqual(["hi"]);
  });
});

describe("pushWrappedWithPrefix", () => {
  it("uses the prefix on the first line and spaces on continuations", () => {
    const lines: string[] = [];
    pushWrappedWithPrefix({ lines, prefix: "→ ", text: "one two three four", width: 10 });
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]).toMatch(/^→ /);
    for (const line of lines.slice(1)) {
      expect(line).toMatch(/^ {2}/);
      expect(line.startsWith("→ ")).toBe(false);
    }
  });

  it("keeps a single line when it fits", () => {
    const lines: string[] = [];
    pushWrappedWithPrefix({ lines, prefix: "x", text: "short", width: 20 });
    expect(lines).toEqual(["xshort"]);
  });
});

describe("renderMiniBox", () => {
  it("renders a bordered box with a padded title and body lines", () => {
    const theme = makeTheme() as unknown as Theme;
    const lines = renderMiniBox(theme, "Details", ["body one", "body two"], 16);
    expect(lines[0]).toContain("╭");
    expect(lines[0]).toContain("╮");
    expect(lines[1]).toContain("│");
    expect(lines[1]).toContain("Details");
    expect(lines[2]).toContain("body one");
    expect(lines[3]).toContain("body two");
    expect(lines[lines.length - 1]).toContain("╰");
    expect(lines[lines.length - 1]).toContain("╯");
  });

  it("wraps body lines that exceed the inner width", () => {
    const theme = makeTheme() as unknown as Theme;
    const lines = renderMiniBox(theme, "D", ["a long line that wraps"], 10);
    expect(lines.length).toBeGreaterThan(3);
  });

  it("drops the border below 8 columns and truncates instead", () => {
    const theme = makeTheme() as unknown as Theme;
    const lines = renderMiniBox(theme, "Details", ["body"], 5);
    expect(lines.join("\n")).not.toContain("╭");
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(5);
    }
    expect(lines[0]).toContain("De");
  });
});

describe("renderPrompt", () => {
  it("renders plain prompt text into lines", () => {
    const lines = renderPrompt("Hello world", 30);
    expect(lines.join("\n")).toContain("Hello world");
  });

  it("wraps long prompts", () => {
    const lines = renderPrompt("word ".repeat(30), 10);
    expect(lines.length).toBeGreaterThan(2);
  });
});

// ── form-render.ts ─────────────────────────────────────────────────────────

describe("renderFormFrame header", () => {
  it("renders title, question context, progress line, and option markers", () => {
    const { text, lines } = renderFrame(frameArgs());
    expect(text).toContain("ask_user"); // no title → default label
    expect(text).toContain("Question 1/2 · Pick");
    expect(text).toContain("Step 1/3");
    expect(text).toContain("( ) Alpha");
    expect(text).toContain("( ) Beta");
    expect(lines[0]).toContain("╭");
    expect(lines[lines.length - 1]).toContain("╰");
  });

  it("renders the questionnaire title and intro divider when present", () => {
    const controller = makeController([choiceQuestion(), textQuestion()], {
      title: "Deploy",
      intro: "We need a decision.",
    });
    const { text } = renderFrame(frameArgs({ controller }));
    expect(text).toContain("Deploy");
    expect(text).toContain("We need a decision.");
    expect(text).toContain("─");
  });

  it("truncates every line when the width is below 8", () => {
    const { lines } = renderFrame(frameArgs({ width: 5 }));
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(5);
    }
    expect(lines.join("\n")).not.toContain("╭");
  });
});

describe("renderFormFrame choice screen", () => {
  it("highlights the focused option with accent color and arrow prefix", () => {
    const theme = makeTheme();
    const { text } = renderFrame(
      frameArgs({ theme: theme as unknown as Theme, choiceFocusIndex: 1 }),
    );
    expect(text).toContain("→");
    const accents = theme.calls.filter(([color]) => color === "accent");
    expect(accents.some(([, t]) => t.includes("Beta"))).toBe(true);
    const nonFocused = theme.calls.filter(([color]) => color === "muted");
    expect(nonFocused.some(([, t]) => t.includes("First option"))).toBe(true);
  });

  it("marks recommended and commented options", () => {
    const controller = makeController([
      choiceQuestion({
        recommendedIndexes: [0],
        options: [
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
        ],
      }),
    ]);
    controller.setChoiceOptionComment(
      controller.currentQuestion as NormalizedChoiceQuestion,
      1,
      "wait",
    );
    const { text } = renderFrame(frameArgs({ controller }));
    expect(text).toContain("[recommended]");
    expect(text).toContain("[comment]");
  });

  it("shows selected markers for multi-select questions", () => {
    const controller = makeController([choiceQuestion({ multi: true, recommendedIndexes: [0] })]);
    const { text } = renderFrame(frameArgs({ controller }));
    expect(text).toContain("[x] Alpha");
    expect(text).toContain("[ ] Beta");
  });

  it("renders a details card below the options when the width is below 80", () => {
    const { text } = renderFrame(frameArgs({ width: 60, detailsText: "Consider the trade-offs." }));
    expect(text).toContain("Details");
    expect(text).toContain("Consider the trade-offs.");
  });

  it("renders a side-by-side details split when the width is at least 80", () => {
    const { text } = renderFrame(frameArgs({ width: 90, detailsText: "Trade-offs here." }));
    expect(text).toContain("│");
    expect(text).toContain("Details");
    expect(text).toContain("Trade-offs here.");
  });

  it("shows the unanswered warning line for a marked-unanswered question", () => {
    const controller = makeController([choiceQuestion()]);
    controller.markCurrentQuestionUnanswered();
    const { text } = renderFrame(frameArgs({ controller }));
    expect(text).toContain("Marked unanswered; comments preserved.");
  });

  it("uses the single-select footer by default and the multi footer for multi questions", () => {
    const single = renderFrame(frameArgs());
    expect(single.text).toContain("Space select");
    const multi = renderFrame(
      frameArgs({ controller: makeController([choiceQuestion({ multi: true })]) }),
    );
    expect(multi.text).toContain("Space toggle");
  });
});

describe("renderFormFrame text screen", () => {
  it("renders the editor and a placeholder hint when empty", () => {
    const editor = stubEditor("");
    const { text } = renderFrame(
      frameArgs({
        controller: makeController([textQuestion({ placeholder: "Type something" })]),
        editor,
      }),
    );
    expect(text).toContain("Your answer");
    expect(text).toContain("Placeholder: Type something");
    expect(text).toContain("Enter submit");
  });

  it("omits the placeholder hint when the editor has text", () => {
    const editor = stubEditor("typed");
    const { text } = renderFrame(
      frameArgs({
        controller: makeController([textQuestion({ placeholder: "Type something" })]),
        editor,
      }),
    );
    expect(text).not.toContain("Placeholder:");
    expect(text).toContain("> typed");
  });

  it("advertises the editor-owned escape when editorHandlesEscape is set", () => {
    const { text } = renderFrame(
      frameArgs({ controller: makeController([textQuestion()]), editorHandlesEscape: true }),
    );
    expect(text).toContain("Esc editor");
    expect(text).not.toContain("Esc cancel");
  });
});

describe("renderFormFrame editor modes", () => {
  it("renders a labeled editor screen with a save/discard footer", () => {
    const controller = makeController([choiceQuestion(), textQuestion()]);
    for (const mode of ["question-comment", "form-comment", "option-comment"] as const) {
      const { text } = renderFrame(
        frameArgs({
          controller,
          mode,
          focus: "editor",
          editorLabel: "Question comment",
          editorContext: "Pick",
        }),
      );
      expect(text).toContain("Question comment: Pick");
      expect(text).toContain("Enter save · Esc discard");
    }
  });

  it("uses the default editor label when none is given", () => {
    const { text } = renderFrame(
      frameArgs({ mode: "form-comment", focus: "editor", editorContext: undefined }),
    );
    expect(text).toContain("Editor");
  });
});

describe("renderFormFrame review mode", () => {
  it("renders the review footer and step label", () => {
    const controller = makeController([choiceQuestion(), textQuestion()]);
    const { text } = renderFrame(frameArgs({ controller, mode: "review", focus: "review" }));
    expect(text).toContain("Step review");
    expect(text).toContain("Review · all questions");
    expect(text).toContain("Enter edit/submit");
  });
});

describe("renderFormFrame scroll clipping", () => {
  const manyOptions = (count: number) =>
    choiceQuestion({
      id: "many",
      header: "Many",
      options: Array.from({ length: count }, (_, i) => ({
        value: `v${i}`,
        label: `Option number ${i}`,
        description: `Description for option ${i}`,
      })),
    });

  it("clips a long choice body to the viewport with hidden/more indicators", () => {
    const controller = makeController([manyOptions(12)]);
    const rendered = renderFormFrame(
      frameArgs({
        controller,
        width: 60,
        viewportHeight: 14,
        choiceFocusIndex: 8,
      }),
    );
    expect(rendered.scrollOffset).toBeGreaterThan(0);
    const text = rendered.lines.join("\n");
    expect(text).toMatch(/↑ \d+ hidden/);
    expect(text).toMatch(/▾ \d+ more/);
    // The focused option is revealed inside the viewport.
    expect(text).toContain("Option number 8");
    // The footer survives the clip.
    expect(text).toContain("Space select");
  });

  it("keeps the full body when it fits in the viewport", () => {
    const controller = makeController([choiceQuestion()]);
    const rendered = renderFormFrame(
      frameArgs({ controller, width: 60, viewportHeight: 30, choiceFocusIndex: 0 }),
    );
    expect(rendered.scrollOffset).toBe(0);
    const text = rendered.lines.join("\n");
    expect(text).not.toContain("hidden");
    expect(text).not.toContain("more");
    expect(text).toContain("Beta");
  });

  it("clips review screens as well (focus on the submit card)", () => {
    const controller = makeController([manyOptions(12), textQuestion()]);
    const rendered = renderFormFrame(
      frameArgs({
        controller,
        mode: "review",
        focus: "review",
        width: 60,
        viewportHeight: 16,
        // Submit card is at index questionCount (2 here).
        reviewFocusIndex: 2,
      }),
    );
    expect(rendered.scrollOffset).toBeGreaterThan(0);
    const text = rendered.lines.join("\n");
    expect(text).toMatch(/↑ \d+ hidden/);
    expect(text).toContain("Submit form");
    // The clipped footer is preserved.
    expect(text).toContain("Enter edit/submit");
  });
});

// ── form-review-render.ts ──────────────────────────────────────────────────

describe("renderReviewScreen", () => {
  function reviewArgs(
    controller: AskUserController,
    overrides: Partial<RenderFormFrameArgs> = {},
  ): RenderFormFrameArgs {
    return frameArgs({ controller, mode: "review", focus: "review", ...overrides });
  }

  it("renders answered and unanswered question cards with status markers", () => {
    const controller = makeController([choiceQuestion(), textQuestion()]);
    controller.selectChoiceOption(controller.currentQuestion as NormalizedChoiceQuestion, 0);
    const { lines } = renderReviewScreen(reviewArgs(controller));
    const text = lines.join("\n");
    expect(text).toContain("Review your answers");
    expect(text).toContain("[✓] Pick");
    expect(text).toContain("[?] Notes");
    expect(text).toContain("Answer: unanswered");
  });

  it("shows selected options and option comments inside a card", () => {
    const controller = makeController([choiceQuestion()]);
    const question = controller.currentQuestion as NormalizedChoiceQuestion;
    controller.selectChoiceOption(question, 0);
    controller.setChoiceOptionComment(question, 0, "because");
    const { lines } = renderReviewScreen(reviewArgs(controller));
    const text = lines.join("\n");
    // Only touched options (selected and/or commented) are listed in review.
    expect(text).toContain("(*) Alpha");
    expect(text).toContain("— because");
    expect(text).not.toContain("( ) Beta");
  });

  it("uses multi-select markers for multi questions", () => {
    const controller = makeController([choiceQuestion({ multi: true, recommendedIndexes: [1] })]);
    const { lines } = renderReviewScreen(reviewArgs(controller));
    const text = lines.join("\n");
    expect(text).toContain("[x] Beta");
    expect(text).not.toContain("[ ] Alpha");
  });

  it("renders a question comment line and the form comment box", () => {
    const controller = makeController([choiceQuestion(), textQuestion()]);
    controller.setQuestionComment("c1", "check this");
    controller.setComment("overall note");
    const { lines } = renderReviewScreen(reviewArgs(controller));
    const text = lines.join("\n");
    expect(text).toContain("Question comment: check this");
    expect(text).toContain("Form comment");
    expect(text).toContain("overall note");
  });

  it("outlines the focused card in accent and renders the submit card", () => {
    const theme = makeTheme();
    const controller = makeController([choiceQuestion(), textQuestion()]);
    const { lines } = renderReviewScreen(
      reviewArgs(controller, { theme: theme as unknown as Theme, reviewFocusIndex: 1 }),
    );
    const text = lines.join("\n");
    expect(text).toContain("Submit form");
    expect(text).toContain("Enter submits · c edits form comment");
    const accents = theme.calls.filter(([color]) => color === "accent");
    // The focused card's prefix arrow and bottom border are accent-colored.
    expect(accents.some(([, t]) => t.includes("→"))).toBe(true);
    expect(accents.some(([, t]) => t.startsWith("╰"))).toBe(true);
    expect(accents.some(([, t]) => t.includes("Submit form"))).toBe(false);
    const borderMuted = theme.calls.filter(([color]) => color === "borderMuted");
    expect(borderMuted.some(([, t]) => t.includes("╭"))).toBe(true);
  });

  it("focuses the submit card when reviewFocusIndex equals the question count", () => {
    const theme = makeTheme();
    const controller = makeController([choiceQuestion(), textQuestion()]);
    const { lines } = renderReviewScreen(
      reviewArgs(controller, { theme: theme as unknown as Theme, reviewFocusIndex: 2 }),
    );
    expect(lines.join("\n")).toContain("Submit form");
    const accents = theme.calls.filter(([color]) => color === "accent");
    expect(accents.some(([, t]) => t.includes("Submit form"))).toBe(true);
  });

  it("renders an answered text card with its value", () => {
    const controller = makeController([textQuestion()]);
    controller.setTextAnswer("t1", "the answer");
    const { lines } = renderReviewScreen(reviewArgs(controller));
    expect(lines.join("\n")).toContain("Answer: the answer");
  });
});
