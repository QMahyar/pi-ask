import type { Theme } from "@earendil-works/pi-coding-agent";
import { type EditorComponent, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { choiceMarker } from "../render/answer-format.ts";
import type { AskUserController } from "../session/controller.ts";
import type { NormalizedChoiceQuestion } from "../types.ts";
import {
  formatSplitLine,
  padRight,
  pushWrappedWithPrefix,
  renderMiniBox,
  renderPrompt,
  safeWidth,
} from "./form-render-primitives.ts";
import { renderReviewScreen } from "./form-review-render.ts";
import type { FocusTarget, FormMode } from "./form-view.ts";
import { revealScroll } from "./ui-logic.ts";

export interface RenderFormFrameArgs {
  width: number;
  theme: Theme;
  controller: AskUserController;
  mode: FormMode;
  focus: FocusTarget;
  editor: EditorComponent;
  choiceFocusIndex: number;
  reviewFocusIndex: number;
  detailsText?: string;
  editorLabel?: string;
  editorContext?: string;
  /** Line-based scroll offset into the body; only used for choice/review modes. */
  scrollOffset?: number;
  /** Available terminal rows for the whole frame (borders included). */
  viewportHeight?: number;
  /** The custom editor handles Escape itself, so the footer hint must not promise cancel. */
  editorHandlesEscape?: boolean;
}

export interface FrameBody {
  lines: string[];
  /** Line range of the focused item, relative to `lines`. */
  focusStart?: number;
  focusEnd?: number;
}

interface FrameContent extends FrameBody {
  /** Index into `lines` where the scrollable body begins. */
  bodyStart: number;
  bodyLength: number;
}

export function renderFormFrame(args: RenderFormFrameArgs): {
  lines: string[];
  scrollOffset: number;
} {
  const width = safeWidth(args.width);
  if (width < 8) {
    const frame = renderFrameContent({ ...args, width });
    return { lines: frame.lines.map((line) => truncateToWidth(line, width)), scrollOffset: 0 };
  }

  const innerWidth = Math.max(1, width - 4);
  const frame = renderFrameContent({ ...args, width: innerWidth });
  const border = args.theme.fg("borderAccent", "│");
  const top = args.theme.fg("borderAccent", `╭${"─".repeat(width - 2)}╮`);
  const bottom = args.theme.fg("borderAccent", `╰${"─".repeat(width - 2)}╯`);

  let content = frame.lines;
  let scrollOffset = 0;
  if (isScrollableMode(args.mode) && args.viewportHeight !== undefined) {
    const clipped = clipFrameBody(args, frame, args.viewportHeight - 2);
    if (clipped) {
      content = clipped.lines;
      scrollOffset = clipped.scrollOffset;
    }
  }

  return {
    lines: [
      top,
      ...content.map((line) => `${border} ${padRight(line, innerWidth)} ${border}`),
      bottom,
    ].map((line) => truncateToWidth(line, width)),
    scrollOffset,
  };
}

/** Clip the body of a scrollable frame to the viewport, revealing the focus. */
function clipFrameBody(
  args: RenderFormFrameArgs,
  frame: FrameContent,
  viewport: number,
): { lines: string[]; scrollOffset: number } | undefined {
  const headerLines = frame.bodyStart;
  const footerLines = frame.lines.length - frame.bodyStart - frame.bodyLength;
  const bodyViewport = viewport - headerLines - footerLines;
  if (bodyViewport < 1 || frame.lines.length <= viewport) return undefined;

  const body = frame.lines.slice(frame.bodyStart, frame.bodyStart + frame.bodyLength);
  // Indicators consume up to two viewport lines; reveal the focus within the
  // content area that remains, so the focused card is never clipped itself.
  const revealViewport = Math.max(1, bodyViewport - 2);
  const scrollOffset = revealScroll(
    args.scrollOffset ?? 0,
    frame.focusStart ?? 0,
    frame.focusEnd ?? 0,
    body.length,
    revealViewport,
  );

  const hiddenAbove = scrollOffset > 0;
  let visible = body.slice(
    scrollOffset,
    scrollOffset + Math.max(0, bodyViewport - (hiddenAbove ? 1 : 0)),
  );
  let hiddenBelow = body.length - scrollOffset - visible.length;
  if (hiddenBelow > 0 && visible.length > 0) {
    visible = visible.slice(0, visible.length - 1);
    hiddenBelow = body.length - scrollOffset - visible.length;
  }

  const middle: string[] = [];
  if (hiddenAbove) middle.push(args.theme.fg("dim", `↑ ${scrollOffset} hidden`));
  middle.push(...visible);
  if (hiddenBelow > 0) middle.push(args.theme.fg("dim", `▾ ${hiddenBelow} more`));

  return {
    lines: [
      ...frame.lines.slice(0, frame.bodyStart),
      ...middle,
      ...frame.lines.slice(frame.bodyStart + frame.bodyLength),
    ],
    scrollOffset,
  };
}

function isScrollableMode(mode: FormMode): boolean {
  return mode === "choice" || mode === "review";
}

function renderFrameContent(args: RenderFormFrameArgs): FrameContent {
  const width = safeWidth(args.width);
  const lines: string[] = [];
  lines.push(...renderHeader(args));
  lines.push("");
  const bodyStart = lines.length;

  let body: FrameBody;
  if (args.mode === "review") {
    body = renderReviewScreen(args);
  } else if (isEditorMode(args.mode)) {
    body = { lines: renderEditorScreen(args) };
  } else {
    const question = args.controller.currentQuestion;
    body = question.type === "text" ? { lines: renderTextScreen(args) } : renderChoiceScreen(args);
  }
  lines.push(...body.lines);

  lines.push("");
  lines.push(...wrapTextWithAnsi(args.theme.fg("dim", renderFooter(args)), width));

  return {
    lines: lines.map((line) => truncateToWidth(line, width)),
    bodyStart,
    bodyLength: body.lines.length,
    focusStart: body.focusStart,
    focusEnd: body.focusEnd,
  };
}

function renderHeader(args: RenderFormFrameArgs): string[] {
  const lines: string[] = [];
  const { intro, title } = args.controller.questionnaire;
  const titleText = args.theme.fg("accent", args.theme.bold(title ?? "ask_user"));
  const contextText = args.theme.fg("muted", headerContext(args));

  lines.push(formatSplitLine(titleText, contextText, args.width));
  lines.push(renderProgressLine(args));

  if (intro) {
    lines.push("");
    lines.push(...renderPrompt(intro, args.width));
    lines.push("");
    lines.push(args.theme.fg("borderMuted", "─".repeat(args.width)));
  }

  return lines;
}

function headerContext(args: RenderFormFrameArgs): string {
  if (args.mode === "review") return "Review · all questions";
  if (args.mode === "form-comment") return "Review · form comment";

  const q = args.controller.currentQuestion;
  return `Question ${args.controller.currentIndex + 1}/${args.controller.questionnaire.questions.length} · ${q.header}`;
}

function renderProgressLine(args: RenderFormFrameArgs): string {
  const questionCount = args.controller.questionnaire.questions.length;
  const totalSteps = questionCount + 1;
  const currentStep =
    args.mode === "review" || args.mode === "form-comment"
      ? totalSteps
      : args.controller.currentIndex + 1;
  const segments = Array.from({ length: totalSteps }, (_entry, index) => {
    if (index < currentStep - 1) return args.theme.fg("success", "●");
    if (index === currentStep - 1) return args.theme.fg("accent", "●");
    return args.theme.fg("dim", "○");
  }).join(" ");
  const label =
    args.mode === "review" || args.mode === "form-comment"
      ? "Step review"
      : `Step ${currentStep}/${totalSteps}`;

  return truncateToWidth(`${args.theme.fg("dim", label)}  ${segments}`, args.width);
}

function renderChoiceScreen(args: RenderFormFrameArgs): FrameBody {
  const lines: string[] = [];
  const question = args.controller.currentQuestion;

  if (question.type !== "choice") return { lines };

  lines.push(...renderPrompt(question.prompt, args.width));
  if (args.controller.isQuestionMarkedUnanswered(question.id)) {
    lines.push("");
    lines.push(args.theme.fg("warning", "Marked unanswered; comments preserved."));
  }
  lines.push("");

  if (args.detailsText && args.width >= 80) {
    const merged = renderChoiceWithDetails(args, question);
    const promptLines = lines.length;
    return {
      lines: [...lines, ...merged.lines],
      focusStart: merged.focusStart === undefined ? undefined : merged.focusStart + promptLines,
      focusEnd: merged.focusEnd === undefined ? undefined : merged.focusEnd + promptLines,
    };
  }

  let focusStart: number | undefined;
  let focusEnd: number | undefined;
  for (let i = 0; i < question.options.length; i += 1) {
    const start = lines.length;
    lines.push(...renderChoiceOptionLines(args, question, i, args.width));
    if (i === args.choiceFocusIndex) {
      focusStart = start;
      focusEnd = lines.length;
    }
  }

  if (args.detailsText) {
    lines.push("");
    lines.push(...renderDetailsCard(args.theme, args.detailsText, args.width));
  }

  return { lines, focusStart, focusEnd };
}

function renderChoiceWithDetails(
  args: RenderFormFrameArgs,
  question: NormalizedChoiceQuestion,
): FrameBody {
  const gap = 2;
  const divider = args.theme.fg("borderMuted", "│");
  const dividerWidth = 1;
  const minLeftWidth = 28;
  const preferredDetailsWidth = Math.max(30, Math.floor(args.width * 0.38));
  const rightWidth = Math.max(
    22,
    Math.min(preferredDetailsWidth, args.width - gap - dividerWidth - gap - minLeftWidth),
  );
  const leftWidth = Math.max(1, args.width - gap - dividerWidth - gap - rightWidth);

  const optionLines: string[] = [];
  let focusStart: number | undefined;
  let focusEnd: number | undefined;
  for (let i = 0; i < question.options.length; i += 1) {
    const start = optionLines.length;
    optionLines.push(...renderChoiceOptionLines(args, question, i, leftWidth));
    if (i === args.choiceFocusIndex) {
      focusStart = start;
      focusEnd = optionLines.length;
    }
  }

  const detailsLines = renderDetailsCard(args.theme, args.detailsText ?? "", rightWidth);

  const merged: string[] = [];
  const maxRows = Math.max(optionLines.length, detailsLines.length);
  for (let i = 0; i < maxRows; i += 1) {
    const left = optionLines[i] ?? "";
    const right = detailsLines[i] ?? "";
    const mergedLine = `${padRight(left, leftWidth)}${" ".repeat(gap)}${divider}${" ".repeat(gap)}${right}`;
    merged.push(truncateToWidth(mergedLine, args.width));
  }

  return { lines: merged, focusStart, focusEnd };
}

function renderChoiceOptionLines(
  args: RenderFormFrameArgs,
  question: NormalizedChoiceQuestion,
  optionIndex: number,
  width: number,
): string[] {
  const lines: string[] = [];
  const opt = question.options[optionIndex];
  const focused = optionIndex === args.choiceFocusIndex;
  const selected = args.controller.isOptionSelected(question.id, opt.value);
  const hasComment = !!args.controller.getOptionComment(question.id, opt.value);

  const marker = choiceMarker(question.multi, selected);
  const isRecommended = question.recommendedIndexes.includes(optionIndex);
  const prefix = focused ? "  → " : "    ";
  const label = `${marker} ${opt.label}${isRecommended ? " [recommended]" : ""}${hasComment ? " [comment]" : ""}`;
  pushWrappedWithPrefix({
    lines,
    prefix,
    text: focused ? args.theme.fg("accent", label) : label,
    width,
  });

  if (opt.description) {
    pushWrappedWithPrefix({
      lines,
      prefix: "       ",
      text: args.theme.fg("muted", opt.description),
      width,
    });
  }

  return lines;
}

function renderTextScreen(args: RenderFormFrameArgs): string[] {
  const lines: string[] = [];
  const question = args.controller.currentQuestion;

  if (question.type !== "text") return lines;

  lines.push(...renderPrompt(question.prompt, args.width));
  lines.push("");
  lines.push(args.theme.fg("accent", "Your answer"));
  lines.push(...args.editor.render(safeWidth(args.width)));

  if (question.placeholder && !args.editor.getText()) {
    lines.push("");
    lines.push(
      ...wrapTextWithAnsi(args.theme.fg("dim", `Placeholder: ${question.placeholder}`), args.width),
    );
  }

  return lines;
}

function renderEditorScreen(args: RenderFormFrameArgs): string[] {
  const lines: string[] = [];
  const label = args.editorLabel ?? "Editor";
  const title = args.editorContext ? `${label}: ${args.editorContext}` : label;
  lines.push(args.theme.fg("accent", title));
  lines.push(...args.editor.render(safeWidth(args.width)));
  return lines;
}

function renderDetailsCard(theme: Theme, detailsText: string, width: number): string[] {
  const innerWidth = Math.max(1, safeWidth(width) - 4);
  return renderMiniBox(theme, "Details", renderPrompt(detailsText, innerWidth), width);
}

function renderFooter(args: RenderFormFrameArgs): string {
  if (args.mode === "review") {
    return "Keys: ↑↓ move · Enter edit/submit · c form comment · ←/Shift+Tab back · Esc cancel";
  }

  if (isEditorMode(args.mode)) {
    return "Keys: Enter save · Esc discard";
  }

  const question = args.controller.currentQuestion;

  if (question.type === "text") {
    const escapeHint = args.editorHandlesEscape ? "Esc editor" : "Esc cancel";
    return `Keys: Enter submit · Alt+C question comment · Alt+U unanswered · Tab next · Shift+Tab back · ${escapeHint}`;
  }

  if (question.multi) {
    return "Keys: ↑↓ move · Space toggle · Enter accept · c question comment · n option comment · u unanswered · ←/→ or Tab/Shift+Tab · Esc cancel";
  }

  return "Keys: ↑↓ move · Space select · Enter select · c question comment · n option comment · u unanswered · ←/→ or Tab/Shift+Tab · Esc cancel";
}

function isEditorMode(mode: FormMode): boolean {
  return mode === "question-comment" || mode === "form-comment" || mode === "option-comment";
}
