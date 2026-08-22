import {
  type Component,
  Editor,
  type EditorComponent,
  type EditorTheme,
  type Focusable,
  isFocusable,
  Key,
  matchesKey,
} from "@earendil-works/pi-tui";
import type { NormalizedChoiceQuestion } from "../types.ts";
import { renderFormFrame } from "./form-render.ts";
import { defaultChoiceRowIndex, type FormMode, focusForMode } from "./form-view.ts";
import type { FormArgs } from "./types.ts";
import {
  decodeKeyForCompare,
  FORM_LIST_PAGE_SIZE,
  formViewportHeight,
  nextFocusIndex,
} from "./ui-logic.ts";

export class AskUserForm implements Component, Focusable {
  focused: boolean = false;
  private readonly editor: EditorComponent;
  private readonly editorHandlesEscape: boolean;
  private settingEditorText: boolean = false;
  private choiceFocusIndex = 0;
  private readonly choiceFocusByQuestionId = new Map<string, number>();
  private reviewFocusIndex = 0;
  /** Choice cursor to restore when the active comment overlay closes. */
  private overlayReturnFocus: number | undefined;
  private closed: boolean = false;
  private cachedWidth: number | undefined;
  private cachedEditorFocused: boolean | undefined;
  private cachedRows: number | undefined;
  private cachedLines: string[] | undefined;
  private pendingEsc: boolean = false;
  private pendingEscTimer: ReturnType<typeof setTimeout> | undefined;
  private scrollOffset = 0;
  private readonly onAbort: () => void;

  constructor(private readonly args: FormArgs) {
    const { editor, handlesEscape } = createFormEditor(args, {
      onChange: () => {
        if (this.settingEditorText) return;
        this.syncTextAnswerFromEditor();
        this.refresh();
      },
      onSubmit: (value) => this.handleEditorSubmit(value),
      onEscape: () => this.handleEditorEscape(),
    });
    this.editor = editor;
    this.editorHandlesEscape = handlesEscape;
    this.syncCurrentQuestion();
    this.onAbort = () => {
      this.args.controller.abort();
      this.finish();
    };
    args.signal?.addEventListener("abort", this.onAbort);
  }

  render(width: number): string[] {
    const mode = this.currentMode();
    const focus = focusForMode(mode);
    const editorFocused = this.focused && focus === "editor";
    if (isFocusable(this.editor)) this.editor.focused = editorFocused;

    const rows = this.args.tui.terminal.rows;
    if (
      this.cachedWidth === width &&
      this.cachedRows === rows &&
      this.cachedEditorFocused === editorFocused &&
      this.cachedLines
    ) {
      return this.cachedLines;
    }

    this.cachedWidth = width;
    this.cachedRows = rows;
    this.cachedEditorFocused = editorFocused;
    const rendered = renderFormFrame({
      width,
      theme: this.args.theme,
      controller: this.args.controller,
      mode,
      focus,
      editor: this.editor,
      choiceFocusIndex: this.choiceFocusIndex,
      reviewFocusIndex: this.reviewFocusIndex,
      detailsText: this.currentDetailsText(),
      editorLabel: this.currentEditorLabel(),
      editorContext: this.currentEditorContext(),
      scrollOffset: this.scrollOffset,
      viewportHeight: formViewportHeight(rows),
      editorHandlesEscape: this.editorHandlesEscape,
    });
    this.scrollOffset = rendered.scrollOffset;
    this.cachedLines = rendered.lines;
    return this.cachedLines;
  }

  handleInput(data: string): void {
    if (this.closed || this.args.controller.isTerminal) return;

    if (this.args.keybindings.matches(data, "app.tools.expand")) {
      this.args.onToggleToolsExpanded?.();
      return;
    }

    if (this.handleEscapeKey(data)) return;
    if (this.handleNavigationKey(data)) return;

    if (this.isCommentEditorMode()) {
      this.handleCommentEditorKey(data);
      return;
    }

    const mode = this.currentMode();

    if ((mode === "review" || mode === "choice") && matchesKey(data, Key.ctrl("c"))) {
      this.args.controller.cancel();
      this.finish();
      return;
    }

    const decoded = decodeKeyForCompare(data);

    if (mode === "review") {
      this.handleReviewInput(data, decoded);
      return;
    }

    const question = this.args.controller.currentQuestion;
    if (question.type === "text") {
      this.handleTextKey(data, decoded);
      return;
    }

    this.handleChoiceKey(data, decoded);
  }

  private handleEscapeKey(data: string): boolean {
    if (!matchesKey(data, Key.escape)) return false;

    if (this.editorHandlesEscape && (this.currentMode() === "text" || this.isCommentEditorMode())) {
      this.editor.handleInput(data);
      if (!this.closed) this.refresh();
      return true;
    }

    if (this.isCommentEditorMode()) {
      this.returnFromCommentEditor();
      this.refresh();
      return true;
    }

    if (this.currentMode() === "text") {
      this.pendingEsc = true;
      this.pendingEscTimer = setTimeout(() => {
        if (this.closed || !this.pendingEsc) return;
        this.clearPendingEsc();
        this.args.controller.cancel();
        this.finish();
      }, 80);
      return true;
    }

    this.args.controller.cancel();
    this.finish();
    return true;
  }

  private handleEditorEscape(): void {
    if (this.isCommentEditorMode()) {
      this.returnFromCommentEditor();
      this.refresh();
      return;
    }
    if (this.currentMode() === "text") {
      this.args.controller.cancel();
      this.finish();
    }
  }

  private clearPendingEsc(): void {
    this.pendingEsc = false;
    if (this.pendingEscTimer !== undefined) {
      clearTimeout(this.pendingEscTimer);
      this.pendingEscTimer = undefined;
    }
  }

  private handleNavigationKey(data: string): boolean {
    if (this.isCommentEditorMode()) return false;

    const direction = this.navigationDirectionFor(data);
    if (!direction) return false;

    if (direction === "forward" && !this.isReviewMode()) {
      this.navigateForward();
    } else if (direction === "backward") {
      if (this.isReviewMode()) {
        this.goToQuestion(this.args.controller.questionnaire.questions.length - 1);
      } else {
        this.navigateBackward();
      }
    }
    return true;
  }

  private navigationDirectionFor(data: string): "forward" | "backward" | undefined {
    if (matchesKey(data, Key.tab)) return "forward";
    if (matchesKey(data, Key.shift("tab"))) return "backward";
    if (this.currentMode() === "text") return undefined;
    if (matchesKey(data, Key.left)) return "backward";
    if (matchesKey(data, Key.right)) return "forward";
    return undefined;
  }

  private navigateForward(): void {
    this.clearPendingEsc();
    this.syncTextAnswerFromEditor();
    this.goNext();
  }

  private navigateBackward(): void {
    this.clearPendingEsc();
    this.syncTextAnswerFromEditor();
    this.saveCurrentChoiceFocus();
    this.args.controller.goBack();
    this.syncCurrentQuestion();
    this.refresh();
  }

  private isReviewMode(): boolean {
    return this.args.controller.currentScreen === "review";
  }

  private isCommentEditorMode(): boolean {
    return this.args.controller.overlay !== undefined;
  }

  invalidate(): void {
    this.cachedLines = undefined;
    this.editor.invalidate();
  }

  dispose(): void {
    this.closed = true;
    this.clearPendingEsc();
    this.args.signal?.removeEventListener("abort", this.onAbort);
  }

  // ── Review screen ───────────────────────────────────────────────

  private handleReviewInput(data: string, decoded: string): void {
    const questionCount = this.args.controller.questionnaire.questions.length;
    const submitIndex = questionCount;

    if (matchesKey(data, Key.enter)) {
      if (this.reviewFocusIndex === submitIndex) {
        this.finish();
      } else {
        this.goToQuestion(this.reviewFocusIndex, { returnToReview: true });
      }
      return;
    }

    if (matchesKey(data, Key.up)) {
      this.reviewFocusIndex = Math.max(0, this.reviewFocusIndex - 1);
      this.refresh();
      return;
    }

    if (matchesKey(data, Key.down)) {
      this.reviewFocusIndex = Math.min(submitIndex, this.reviewFocusIndex + 1);
      this.refresh();
      return;
    }

    if (matchesKey(data, Key.pageUp)) {
      this.reviewFocusIndex = nextFocusIndex(
        this.reviewFocusIndex,
        -FORM_LIST_PAGE_SIZE,
        submitIndex,
      );
      this.refresh();
      return;
    }

    if (matchesKey(data, Key.pageDown)) {
      this.reviewFocusIndex = nextFocusIndex(
        this.reviewFocusIndex,
        FORM_LIST_PAGE_SIZE,
        submitIndex,
      );
      this.refresh();
      return;
    }

    if (matchesKey(data, Key.home)) {
      this.reviewFocusIndex = 0;
      this.refresh();
      return;
    }

    if (matchesKey(data, Key.end)) {
      this.reviewFocusIndex = submitIndex;
      this.refresh();
      return;
    }

    if (decoded === "c") {
      this.openFormCommentEditor();
    }
  }

  // ── Choice screen ───────────────────────────────────────────────

  private handleChoiceKey(data: string, decoded: string): void {
    const question = this.args.controller.currentQuestion;
    if (question.type !== "choice") return;

    if (matchesKey(data, Key.up)) {
      this.choiceFocusIndex = Math.max(0, this.choiceFocusIndex - 1);
      this.refresh();
      return;
    }

    if (matchesKey(data, Key.down)) {
      this.choiceFocusIndex = Math.min(question.options.length - 1, this.choiceFocusIndex + 1);
      this.refresh();
      return;
    }

    if (matchesKey(data, Key.pageUp)) {
      this.choiceFocusIndex = nextFocusIndex(
        this.choiceFocusIndex,
        -FORM_LIST_PAGE_SIZE,
        question.options.length - 1,
      );
      this.refresh();
      return;
    }

    if (matchesKey(data, Key.pageDown)) {
      this.choiceFocusIndex = nextFocusIndex(
        this.choiceFocusIndex,
        FORM_LIST_PAGE_SIZE,
        question.options.length - 1,
      );
      this.refresh();
      return;
    }

    if (matchesKey(data, Key.home)) {
      this.choiceFocusIndex = 0;
      this.refresh();
      return;
    }

    if (matchesKey(data, Key.end)) {
      this.choiceFocusIndex = question.options.length - 1;
      this.refresh();
      return;
    }

    if (matchesKey(data, Key.space)) {
      if (question.multi) {
        this.args.controller.toggleChoiceOption(question, this.choiceFocusIndex);
      } else {
        this.args.controller.selectChoiceOption(question, this.choiceFocusIndex);
      }
      this.refresh();
      return;
    }

    if (matchesKey(data, Key.enter)) {
      if (!question.multi && !this.args.controller.isQuestionMarkedUnanswered(question.id)) {
        this.args.controller.selectChoiceOption(question, this.choiceFocusIndex);
      }
      this.goNext();
      return;
    }

    if (decoded === "u") {
      this.args.controller.markCurrentQuestionUnanswered();
      this.refresh();
      return;
    }

    if (decoded === "c") {
      this.openQuestionCommentEditor(question.id);
      return;
    }

    if (decoded === "n") {
      this.openOptionCommentEditor(question, this.choiceFocusIndex);
    }
  }

  // ── Text screen ─────────────────────────────────────────────────

  private handleTextKey(data: string, decoded: string): void {
    if (this.pendingEsc) {
      this.clearPendingEsc();
      if (decoded === "u") {
        this.args.controller.markCurrentQuestionUnanswered();
        this.setEditorText("");
        this.refresh();
        return;
      }
      if (decoded === "c") {
        this.syncTextAnswerFromEditor();
        this.openQuestionCommentEditor(this.args.controller.currentQuestion.id);
        return;
      }
    }

    if (matchesKey(data, Key.alt("c"))) {
      this.syncTextAnswerFromEditor();
      this.openQuestionCommentEditor(this.args.controller.currentQuestion.id);
      return;
    }

    if (matchesKey(data, Key.alt("u"))) {
      this.args.controller.markCurrentQuestionUnanswered();
      this.setEditorText("");
      this.refresh();
      return;
    }

    this.editor.handleInput(data);
    this.refresh();
  }

  // ── Comment editors ─────────────────────────────────────────────

  private handleCommentEditorKey(data: string): void {
    this.editor.handleInput(data);
    this.refresh();
  }

  private handleEditorSubmit(value: string): void {
    const overlay = this.args.controller.overlay;
    if (!overlay) {
      if (this.currentMode() === "text") {
        this.args.controller.setTextAnswer(this.args.controller.currentQuestion.id, value);
        this.goNext();
      }
      return;
    }

    switch (overlay.kind) {
      case "form":
        this.args.controller.setComment(value);
        break;
      case "question":
        this.args.controller.setQuestionComment(overlay.questionId, value);
        break;
      case "option": {
        const question = this.args.controller.questionnaire.questions.find(
          (candidate) => candidate.id === overlay.questionId,
        );
        if (question?.type === "choice") {
          const optionIndex = question.options.findIndex(
            (option) => option.value === overlay.optionValue,
          );
          if (optionIndex >= 0) {
            this.args.controller.setChoiceOptionComment(question, optionIndex, value);
          }
        }
        break;
      }
    }

    this.returnFromCommentEditor();
    this.refresh();
  }

  private openFormCommentEditor(): void {
    this.args.controller.openFormComment();
    this.overlayReturnFocus = undefined;
    this.setEditorText(this.args.controller.comment ?? "");
    this.refresh();
  }

  private openQuestionCommentEditor(questionId: string): void {
    this.args.controller.openQuestionComment(questionId);
    this.overlayReturnFocus = this.choiceFocusIndex;
    this.setEditorText(this.args.controller.getQuestionComment(questionId) ?? "");
    this.refresh();
  }

  private openOptionCommentEditor(question: NormalizedChoiceQuestion, optionIndex: number): void {
    const option = question.options[optionIndex];
    if (!option) return;
    this.args.controller.openOptionComment(question.id, option.value);
    this.overlayReturnFocus = optionIndex;
    this.setEditorText(this.args.controller.getOptionComment(question.id, option.value) ?? "");
    this.refresh();
  }

  private returnFromCommentEditor(): void {
    const closed = this.args.controller.closeOverlay();
    if (!closed) return;
    const returnFocus = this.overlayReturnFocus;
    this.overlayReturnFocus = undefined;

    if (closed.kind === "form") {
      this.scrollOffset = 0;
      this.setEditorText("");
      return;
    }

    this.syncCurrentQuestion();
    this.restoreChoiceFocus(
      closed.questionId,
      closed.kind === "option" ? closed.optionValue : undefined,
      returnFocus,
    );
  }

  // ── Navigation helpers ──────────────────────────────────────────

  /** Advance past the current question and resync the view to the new screen. */
  private goNext(): void {
    this.saveCurrentChoiceFocus();
    if (this.args.controller.advance() === "review") {
      // Focus the Submit row by default so Enter submits immediately.
      this.reviewFocusIndex = this.args.controller.questionnaire.questions.length;
      this.scrollOffset = 0;
      this.setEditorText("");
      this.refresh();
      return;
    }
    this.syncCurrentQuestion();
    this.refresh();
  }

  private goToQuestion(index: number, opts: { returnToReview?: boolean } = {}): void {
    this.saveCurrentChoiceFocus();
    if (!this.args.controller.openQuestion(index, opts)) return;
    this.syncCurrentQuestion();
    this.refresh();
  }

  private syncCurrentQuestion(): void {
    const question = this.args.controller.currentQuestion;

    if (question.type === "text") {
      this.scrollOffset = 0;
      this.setEditorText(this.args.controller.getTextAnswer(question.id));
      return;
    }

    this.scrollOffset = 0;
    this.setEditorText("");
    this.choiceFocusIndex =
      this.choiceFocusByQuestionId.get(question.id) ??
      defaultChoiceRowIndex(this.args.controller, question);
  }

  private saveCurrentChoiceFocus(): void {
    const question = this.args.controller.currentQuestion;
    if (question.type === "choice") {
      this.choiceFocusByQuestionId.set(question.id, this.choiceFocusIndex);
    }
  }

  private syncTextAnswerFromEditor(): void {
    if (this.currentMode() !== "text") return;
    const question = this.args.controller.currentQuestion;
    if (question.type !== "text") return;
    this.args.controller.setTextAnswer(
      question.id,
      this.editor.getExpandedText?.() ?? this.editor.getText(),
    );
  }

  private restoreChoiceFocus(
    questionId: string | undefined,
    optionValue: string | undefined,
    fallbackIndex: number | undefined,
  ): void {
    const question = this.args.controller.currentQuestion;
    if (question.type !== "choice" || question.id !== questionId) return;

    const optionIndex =
      optionValue === undefined
        ? fallbackIndex
        : question.options.findIndex((option) => option.value === optionValue);
    if (optionIndex === undefined || optionIndex < 0) return;

    this.choiceFocusIndex = Math.min(optionIndex, question.options.length - 1);
  }

  private setEditorText(value: string): void {
    this.settingEditorText = true;
    try {
      this.editor.setText(value);
    } finally {
      this.settingEditorText = false;
    }
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.args.signal?.removeEventListener("abort", this.onAbort);
    const interactionResult = this.args.controller.getInteractionResult();
    this.args.done(interactionResult ?? this.args.controller.outcome());
  }

  private refresh(): void {
    this.cachedLines = undefined;
    this.args.tui.requestRender();
  }

  private currentMode(): FormMode {
    const overlay = this.args.controller.overlay;
    if (overlay) return `${overlay.kind}-comment`;
    if (this.args.controller.currentScreen === "review") return "review";
    return this.args.controller.currentQuestion.type === "text" ? "text" : "choice";
  }

  private currentDetailsText(): string | undefined {
    if (this.currentMode() !== "choice") return undefined;
    const question = this.args.controller.currentQuestion;
    if (question.type !== "choice") return undefined;
    return question.options[this.choiceFocusIndex]?.details;
  }

  private currentEditorLabel(): string | undefined {
    switch (this.args.controller.overlay?.kind) {
      case "question":
        return "Question comment";
      case "option":
        return "Option comment";
      case "form":
        return "Form comment";
      default:
        return undefined;
    }
  }

  /** Display context for the active comment overlay (title, header, or label). */
  private currentEditorContext(): string | undefined {
    const overlay = this.args.controller.overlay;
    if (!overlay) return undefined;
    switch (overlay.kind) {
      case "form":
        return this.args.controller.questionnaire.title ?? "Form";
      case "question":
        return this.findQuestion(overlay.questionId)?.header;
      case "option": {
        const question = this.findQuestion(overlay.questionId);
        if (question?.type !== "choice") return undefined;
        return question.options.find((option) => option.value === overlay.optionValue)?.label;
      }
    }
  }

  private findQuestion(questionId: string) {
    return this.args.controller.questionnaire.questions.find(
      (candidate) => candidate.id === questionId,
    );
  }
}

interface FormEditorCallbacks {
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onEscape: () => void;
}

function createFormEditor(
  args: FormArgs,
  callbacks: FormEditorCallbacks,
): { editor: EditorComponent; handlesEscape: boolean } {
  const editorTheme = makeEditorTheme(args);
  const createDefault = () => {
    const editor = new Editor(args.tui, editorTheme);
    configureFormEditor(editor, callbacks, false);
    return { editor, handlesEscape: false };
  };
  if (!args.editorFactory) return createDefault();

  try {
    const editor: unknown = args.editorFactory(args.tui, editorTheme, args.keybindings);
    if (!isEditorComponent(editor)) {
      throw new Error("factory returned an invalid EditorComponent");
    }
    const handlesEscape = "onEscape" in editor;
    configureFormEditor(editor, callbacks, handlesEscape);
    return { editor, handlesEscape };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    args.notify?.(
      `Custom editor unavailable in ask_user; using the default editor: ${reason}`,
      "warning",
    );
    return createDefault();
  }
}

function configureFormEditor(
  editor: EditorComponent,
  callbacks: FormEditorCallbacks,
  handlesEscape: boolean,
): void {
  editor.onChange = callbacks.onChange;
  editor.onSubmit = callbacks.onSubmit;
  if (handlesEscape) {
    (editor as EditorComponent & { onEscape: () => void }).onEscape = callbacks.onEscape;
  }
}

function isEditorComponent(value: unknown): value is EditorComponent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return ["render", "invalidate", "getText", "setText", "handleInput"].every(
    (method) => typeof candidate[method] === "function",
  );
}

function makeEditorTheme(args: FormArgs): EditorTheme {
  return {
    borderColor: (text) => args.theme.fg("accent", text),
    selectList: {
      selectedPrefix: (text) => args.theme.fg("accent", text),
      selectedText: (text) => args.theme.fg("accent", text),
      description: (text) => args.theme.fg("muted", text),
      scrollInfo: (text) => args.theme.fg("dim", text),
      noMatch: (text) => args.theme.fg("warning", text),
    },
  };
}
