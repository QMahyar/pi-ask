import { Key, matchesKey, type TUI } from "@earendil-works/pi-tui";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type { AskUserInteractionResult, AskUserOutcome, NormalizedQuestion } from "../src/types.ts";
import { AskUserForm } from "../src/ui/form-component.ts";
import { AskUserController } from "../src/session/controller.ts";
import type { EditorFactory } from "../src/ui/types.ts";

// Drive the real AskUserForm state machine through runFormQuestionnaire's
// custom-factory seam with a stub TUI — no full terminal needed.

// Raw terminal byte sequences (Key.* descriptor constants are not what
// handleInput receives; the host decodes key events into byte strings).
const KEYS = {
  esc: "\x1b",
  enter: "\r",
  up: "\x1b[A",
  down: "\x1b[B",
  tab: "\t",
  shiftTab: "\x1b[Z",
  ctrlC: "\x03",
  ctrlO: "\x0f",
  home: "\x1b[H",
  end: "\x1b[F",
} as const;

const plainTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as never;

function choiceQuestion(overrides: Record<string, unknown> = {}): NormalizedQuestion {
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

function textQuestion(): NormalizedQuestion {
  return { type: "text", id: "t1", header: "Notes", prompt: "Anything else?" };
}

function makeStubTui() {
  return {
    terminal: { rows: 24 },
    requestRender: vi.fn(),
  } as unknown as TUI & { requestRender: ReturnType<typeof vi.fn> };
}

interface Mounted {
  tui: TUI & { requestRender: ReturnType<typeof vi.fn> };
  form: AskUserForm;
  controller: AskUserController;
  donePromise: Promise<AskUserOutcome | AskUserInteractionResult>;
  resolveDone: (result?: AskUserOutcome | AskUserInteractionResult) => void;
}

type MountOptions = {
  questions?: NormalizedQuestion[];
  signal?: AbortSignal;
  notify?: (message: string, type?: "error" | "info" | "warning") => void;
  editorFactory?: EditorFactory;
  onToggleToolsExpanded?: () => void;
};

/** Stub of the host keybindings manager: resolves only app.tools.expand (ctrl+o). */
function makeKeybindings(): KeybindingsManager {
  return {
    matches: (data: string, name: string) =>
      name === "app.tools.expand" && matchesKey(data, Key.ctrl("o")),
  } as unknown as KeybindingsManager;
}

/**
 * Construct the real AskUserForm directly with a real controller (the
 * runFormQuestionnaire factory seam builds its own controller internally,
 * which would make state assertions impossible).
 */
function mountForm(options: MountOptions = {}): Mounted {
  const tui = makeStubTui();
  const keybindings = makeKeybindings();
  const controller = new AskUserController({
    questions: options.questions ?? [choiceQuestion(), textQuestion()],
  });
  let resolveDone!: Mounted["resolveDone"];
  const donePromise = new Promise<AskUserOutcome | AskUserInteractionResult>((resolve) => {
    resolveDone = resolve as Mounted["resolveDone"];
  });

  const form = new AskUserForm({
    tui,
    theme: plainTheme,
    controller,
    done: resolveDone,
    signal: options.signal,
    keybindings,
    onToggleToolsExpanded: options.onToggleToolsExpanded,
    editorFactory: options.editorFactory,
    notify: options.notify,
  });

  return {
    tui,
    form,
    controller,
    donePromise,
    resolveDone,
  };
}

const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("AskUserForm via the custom-factory seam", () => {
  it("constructs a form and renders a border frame", async () => {
    const mounted = mountForm();
    await nextTick();

    const lines = mounted.form.render(60);
    expect(lines[0]).toContain("╭");
    expect(lines.join("\n")).toContain("ask_user");
    expect(lines.join("\n")).toContain("( ) Alpha");

    mounted.form.dispose();
    mounted.resolveDone();
    await mounted.donePromise;
  });

  it("cancels on a single Escape from a choice question", async () => {
    const mounted = mountForm();

    mounted.form.handleInput(KEYS.esc);
    await expect(mounted.donePromise).resolves.toEqual({ kind: "cancel" });
    await mounted.donePromise;
  });

  it("cancels on Ctrl+C from any screen", async () => {
    const mounted = mountForm();

    mounted.form.handleInput(KEYS.ctrlC);
    await expect(mounted.donePromise).resolves.toEqual({ kind: "cancel" });
    await mounted.donePromise;
  });

  it("selects an option, answers text, and submits through the review screen", async () => {
    const mounted = mountForm();

    // Choice: move to option 1 and select it.
    mounted.form.handleInput(KEYS.down);
    mounted.form.handleInput(" ");
    // Enter accepts and moves to the text question.
    mounted.form.handleInput(KEYS.enter);
    // Type the answer and submit with Enter.
    for (const char of "hello") mounted.form.handleInput(char);
    mounted.form.handleInput(KEYS.enter);
    expect(mounted.controller.currentIndex).toBe(1);
    expect(mounted.controller.getTextAnswer("t1")).toBe("hello");

    // Review: navigate to the submit card and submit.
    mounted.form.handleInput(KEYS.down);
    mounted.form.handleInput(KEYS.down);
    mounted.form.handleInput(KEYS.enter);

    const outcome = await mounted.donePromise;
    expect(outcome).toMatchObject({
      outcome: "submitted",
      responses: [
        {
          questionId: "c1",
          answer: { kind: "choice", answered: true, options: [{ value: "b", label: "Beta", selected: true }] },
        },
        { questionId: "t1", answer: { kind: "text", answered: true, value: "hello" } },
      ],
    });
    await mounted.donePromise;
  });

  it("toggles multi-select options with Space and reports needs_discussion when marked unanswered", async () => {
    const mounted = mountForm({
      questions: [choiceQuestion({ id: "m1", multi: true, options: [{ value: "a", label: "A" }, { value: "b", label: "B" }, { value: "c", label: "C" }] })],
    });

    // Toggle twice: selected then unselected.
    mounted.form.handleInput(" ");
    expect(mounted.controller.isOptionSelected("m1", "a")).toBe(true);
    mounted.form.handleInput(" ");
    expect(mounted.controller.isOptionSelected("m1", "a")).toBe(false);

    // Mark the question unanswered.
    mounted.form.handleInput("u");
    expect(mounted.controller.isQuestionMarkedUnanswered("m1")).toBe(true);

    mounted.form.handleInput(KEYS.enter);
    mounted.form.handleInput(KEYS.down); // submit card (1 question → index 1)
    mounted.form.handleInput(KEYS.enter);

    const outcome = await mounted.donePromise;
    expect(outcome).toMatchObject({ outcome: "needs_discussion" });
    await mounted.donePromise;
  });

  it("jumps choice focus with Home/End and selects the focused option", async () => {
    const mounted = mountForm({
      questions: [
        choiceQuestion({
          id: "big",
          options: Array.from({ length: 12 }, (_, i) => ({ value: `v${i}`, label: `L${i}` })),
        }),
      ],
    });

    mounted.form.handleInput(KEYS.end);
    mounted.form.handleInput(" ");
    mounted.form.handleInput(KEYS.enter);
    mounted.form.handleInput(KEYS.down); // submit card
    mounted.form.handleInput(KEYS.enter);

    const outcome = await mounted.donePromise;
    expect(outcome).toMatchObject({
      outcome: "submitted",
      responses: [
        { questionId: "big", answer: { options: [{ value: "v11", selected: true }] } },
      ],
    });
    await mounted.donePromise;
  });

  it("saves an option comment via the 'n' editor and submits it", async () => {
    const mounted = mountForm({ questions: [choiceQuestion()] });

    mounted.form.handleInput("n"); // open option comment editor for focused option
    for (const char of "wait") mounted.form.handleInput(char);
    mounted.form.handleInput(KEYS.enter); // save the comment
    expect(mounted.controller.getOptionComment("c1", "a")).toBe("wait");

    mounted.form.handleInput(KEYS.enter); // accept
    mounted.form.handleInput(KEYS.down); // submit card
    mounted.form.handleInput(KEYS.enter);

    const outcome = await mounted.donePromise;
    expect(outcome).toMatchObject({
      responses: [
        {
          questionId: "c1",
          answer: { options: [{ value: "a", selected: true, comment: "wait" }] },
        },
      ],
    });
    await mounted.donePromise;
  });

  it("saves a form comment from review with 'c'", async () => {
    const mounted = mountForm();

    mounted.form.handleInput(KEYS.enter); // to text question
    mounted.form.handleInput(KEYS.enter); // submit empty text → review
    mounted.form.handleInput("c"); // open form comment editor
    for (const char of "overall") mounted.form.handleInput(char);
    mounted.form.handleInput(KEYS.enter); // save → back to review

    expect(mounted.controller.comment).toBe("overall");
    mounted.form.handleInput(KEYS.down);
    mounted.form.handleInput(KEYS.down);
    mounted.form.handleInput(KEYS.enter);
    const outcome = await mounted.donePromise;
    expect(outcome).toMatchObject({ comment: "overall" });
    await mounted.donePromise;
  });

  it("backs up from review to the last question with Shift+Tab", async () => {
    const mounted = mountForm();

    mounted.form.handleInput(KEYS.enter); // to text
    mounted.form.handleInput(KEYS.enter); // to review
    mounted.form.handleInput(KEYS.shiftTab);
    expect(mounted.controller.currentIndex).toBe(1); // back on the text question

    mounted.form.dispose();
    mounted.resolveDone();
    await mounted.donePromise;
  });

  it("finishes with abort when the signal fires while open", async () => {
    const controller = new AbortController();
    const mounted = mountForm({ signal: controller.signal });

    controller.abort();
    await expect(mounted.donePromise).resolves.toEqual({ kind: "abort" });
    await mounted.donePromise;
  });

  it("ignores input after dispose and clears its abort listener", async () => {
    const controller = new AbortController();
    const mounted = mountForm({ signal: controller.signal });

    mounted.form.dispose();
    mounted.form.handleInput(KEYS.enter); // must be a no-op
    expect(mounted.tui.requestRender).not.toHaveBeenCalled();

    controller.abort(); // listener removed → no finish via abort
    await nextTick();
    mounted.resolveDone();
    await mounted.donePromise;
  });

  it("toggles tool expansion through the keybinding passthrough", async () => {
    const onToggleToolsExpanded = vi.fn();
    const mounted = mountForm({ onToggleToolsExpanded });

    mounted.form.handleInput(KEYS.ctrlO);
    expect(onToggleToolsExpanded).toHaveBeenCalledTimes(1);

    mounted.form.dispose();
    mounted.resolveDone();
    await mounted.donePromise;
  });

  it("falls back to the default editor with a warning when the custom factory fails", async () => {
    const notify = vi.fn();
    const mounted = mountForm({
      questions: [textQuestion()],
      notify,
      editorFactory: (() => ({})) as unknown as EditorFactory,
    });

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Custom editor unavailable in ask_user"),
      "warning",
    );

    // The default editor still accepts input and submits.
    for (const char of "ok") mounted.form.handleInput(char);
    mounted.form.handleInput(KEYS.enter);
    mounted.form.handleInput(KEYS.down);
    mounted.form.handleInput(KEYS.enter);
    const outcome = await mounted.donePromise;
    expect(outcome).toMatchObject({
      outcome: "submitted",
      responses: [{ questionId: "t1", answer: { kind: "text", answered: true, value: "ok" } }],
    });
    await mounted.donePromise;
  });
});