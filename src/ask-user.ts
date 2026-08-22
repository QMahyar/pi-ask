import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import {
  type AskUserBehavior,
  notifyToolPromptSurfaceDiagnostics,
  resolveAskUserBehavior,
  resolveToolPromptSurface,
} from "./core/config/prompt-surface.ts";
import { createSessionNameTracker } from "./core/session-utils.ts";
import { formatTitle, signalWaiting } from "./core/terminal";
import { AskUserValidationError, normalizeQuestionnaire } from "./normalize.ts";
import { type AskUserToolResult, buildResult } from "./render/result.ts";
import { renderAskUserCall, renderAskUserResult } from "./render/transcript.ts";
import { type AskUserParams, AskUserParamsSchema, prepareAskUserArguments } from "./schema.ts";
import { ActiveQuestionnaireLock } from "./session/lock.ts";
import {
  ASK_USER_BEHAVIOR_DEFAULTS,
  ASK_USER_PROMPT_SURFACE_DEFAULTS,
  ASK_USER_TOOL_LABEL,
  ASK_USER_TOOL_NAME,
} from "./tool/guidance.ts";
import {
  type AskUserToolDetails,
  isAskUserInteractionResult,
  type NormalizedQuestionnaire,
} from "./types.ts";
import { runQuestionnaire } from "./ui/choose-renderer.ts";
import type { EditorFactory } from "./ui/types.ts";

export type AskUserExecutionContext = Pick<ExtensionContext, "cwd" | "hasUI" | "mode" | "abort"> & {
  ui: {
    custom?: unknown;
    notify?(message: string, type?: "info" | "warning" | "error"): void;
    setWorkingVisible?(visible: boolean): void;
    setTitle?(title: string): void;
    getToolsExpanded?(): boolean;
    setToolsExpanded?(expanded: boolean): void;
    getEditorComponent?(): EditorFactory | undefined;
  };
};

export default function askUserExtension(pi: ExtensionAPI): void {
  const lock = new ActiveQuestionnaireLock();
  const getSessionName = createSessionNameTracker(pi);
  let disposed = false;

  pi.on("session_shutdown", () => {
    disposed = true;
    // Release any in-flight form's lock: in SDK/multi-session hosts sharing one
    // process, a form left hanging at shutdown would block ask_user for every
    // later session. The owning execute's finally is a no-op for a stale release.
    const owner = lock.getOwner();
    if (owner !== undefined) lock.releaseIfOwner(owner);
  });

  // Label ask_user tool results so they're visible and filterable in /tree.
  // The agent awaits our handler's return before it appends the tool result
  // to the session, so labeling must run from a deferred callback.
  pi.on("tool_result", (event, ctx) => {
    if (!shouldLabelDecision(event.toolName, event.isError)) return;
    scheduleDecisionLabel(pi, ctx, event.toolCallId, () => disposed);
  });

  // Factory-time: register with package defaults.
  registerAskUserTool(
    pi,
    lock,
    ASK_USER_PROMPT_SURFACE_DEFAULTS,
    ASK_USER_BEHAVIOR_DEFAULTS,
    getSessionName,
  );
  registerAskUserEntryRenderer(pi);

  // session_start: re-register with resolved prompt surface and behavior
  // (global + trusted project config).
  pi.on("session_start", async (_event, ctx) => {
    // SDK hosts can cycle shutdown→start on one extension instance; labeling
    // disabled by a previous session_shutdown must come back with the session.
    disposed = false;
    const { surface, diagnostics } = resolveToolPromptSurface({
      section: "ask-user",
      toolName: ASK_USER_TOOL_NAME,
      defaults: ASK_USER_PROMPT_SURFACE_DEFAULTS,
      ctx,
    });
    const { behavior, diagnostics: behaviorDiagnostics } = resolveAskUserBehavior({
      section: "ask-user",
      toolName: ASK_USER_TOOL_NAME,
      defaults: ASK_USER_BEHAVIOR_DEFAULTS,
      ctx,
    });

    registerAskUserTool(pi, lock, surface, behavior, getSessionName);
    notifyToolPromptSurfaceDiagnostics(ctx, [...diagnostics, ...behaviorDiagnostics]);
  });
}

function registerAskUserTool(
  pi: ExtensionAPI,
  lock: ActiveQuestionnaireLock,
  surface: typeof ASK_USER_PROMPT_SURFACE_DEFAULTS,
  behavior: AskUserBehavior,
  getSessionName: () => string | undefined,
): void {
  pi.registerTool<typeof AskUserParamsSchema, AskUserToolDetails>({
    name: ASK_USER_TOOL_NAME,
    label: ASK_USER_TOOL_LABEL,
    description: surface.description,
    promptSnippet: surface.promptSnippet,
    promptGuidelines: surface.promptGuidelines,
    parameters: AskUserParamsSchema,
    prepareArguments: prepareAskUserArguments,
    executionMode: "sequential",
    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      return executeAskUser(params, signal, ctx, lock, pi, getSessionName(), toolCallId, behavior);
    },
    renderCall: (args, theme) => renderAskUserCall(args, theme),
    renderResult: (result, options, theme, context) =>
      renderAskUserResult(result, theme, options, context),
  });
}

// Data persisted via pi.appendEntry for each completed form. Does not participate
// in LLM context; it is rendered in the transcript via the entry renderer below.
export interface AskUserEntryData {
  title?: string;
  questions: number;
}

export function formatAskUserEntrySummary(data: AskUserEntryData): string {
  const title = data.title?.trim() || "ask_user";
  const count = data.questions;
  const noun = count === 1 ? "question" : "questions";
  return `${title} — ${count} ${noun}`;
}

function registerAskUserEntryRenderer(pi: ExtensionAPI): void {
  pi.registerEntryRenderer<AskUserEntryData>("ask_user", (entry, { expanded }, theme) => {
    const data: AskUserEntryData = entry.data ?? { questions: 0 };
    const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
    box.addChild(
      new Text(`${theme.fg("accent", "[ask_user]")} ${formatAskUserEntrySummary(data)}`, 0, 0),
    );
    if (expanded) {
      box.addChild(new Text(theme.fg("dim", JSON.stringify(data, null, 2)), 0, 0));
    }
    return box;
  });
}

export async function executeAskUser(
  params: AskUserParams,
  signal: AbortSignal | undefined,
  ctx: AskUserExecutionContext,
  lock: ActiveQuestionnaireLock,
  pi: ExtensionAPI,
  sessionName?: string,
  toolCallId?: string,
  behavior: AskUserBehavior = ASK_USER_BEHAVIOR_DEFAULTS,
): Promise<AskUserToolResult> {
  let questionnaire: NormalizedQuestionnaire;
  try {
    questionnaire = normalizeQuestionnaire(params);
  } catch (error) {
    if (error instanceof AskUserValidationError) {
      throw new Error(error.message, { cause: error });
    }
    throw error;
  }

  if (!canShowForm(ctx.hasUI, ctx.mode)) {
    throw new Error(
      "ask_user requires an interactive TUI session. No user-facing form UI is available in the current mode.",
    );
  }
  const owner = toolCallId ?? `pi-ask:${++nextLockOwner}`;
  if (!lock.acquire(owner)) {
    throw new Error(
      "another ask_user form is already in flight. Wait for it to complete before calling ask_user again.",
    );
  }

  const onAbort = () => lock.releaseIfOwner(owner);
  try {
    signal?.addEventListener("abort", onAbort);

    signalAttention(ctx, behavior);
    pi.events.emit("pi-ask:ask-user:start", { source: "pi-ask" });
    // herdr lifecycle integration: mark the agent blocked while the form is on
    // screen so herdr reports "blocked" (with the form title as message) and
    // other agents can wait --until blocked on this session. The matching
    // active:false is emitted in the finally block below, on every end path.
    pi.events.emit("herdr:blocked", {
      active: true,
      label: questionnaire.title?.trim() || "ask_user",
    });

    ctx.ui.setWorkingVisible?.(false);
    const outcome = await runQuestionnaire(questionnaire, {
      ui: {
        custom: asFunction(ctx.ui.custom),
        notify: ctx.ui.notify,
        getEditorComponent: ctx.ui.getEditorComponent
          ? () => ctx.ui.getEditorComponent?.()
          : undefined,
      },
      signal,
      onToggleToolsExpanded:
        ctx.ui.getToolsExpanded && ctx.ui.setToolsExpanded
          ? () => ctx.ui.setToolsExpanded?.(!ctx.ui.getToolsExpanded?.())
          : undefined,
    });

    if (outcome === "unsupported") {
      throw new Error(
        "ask_user requires a TUI with custom form support. Do not use ask_user in non-interactive or degraded UI sessions.",
      );
    }

    // Internal cancel/abort: treat as control flow, abort the turn, and mark the tool failed.
    if (isAskUserInteractionResult(outcome)) {
      ctx.abort();
      throw new Error(
        outcome.kind === "abort"
          ? "The user interaction was aborted."
          : "The user interaction was cancelled.",
      );
    }

    pi.appendEntry("ask_user", {
      title: questionnaire.title,
      questions: questionnaire.questions.length,
    });
    return buildResult(questionnaire, outcome);
  } finally {
    signal?.removeEventListener("abort", onAbort);
    ctx.ui.setWorkingVisible?.(true);
    pi.events.emit("pi-ask:ask-user:end", { source: "pi-ask" });
    pi.events.emit("herdr:blocked", { active: false });
    restoreTerminalTitle(ctx, sessionName);
    lock.releaseIfOwner(owner);
  }
}

export function shouldLabelDecision(toolName: string, isError: boolean): boolean {
  return toolName === ASK_USER_TOOL_NAME && !isError;
}

// The session append that follows our handler can itself await I/O, so a
// single deferred tick can lose the race with the timer queue. Poll a bounded
// number of times before giving up; labeling stays best-effort.
const DECISION_LABEL_RETRY_DELAYS_MS: readonly number[] = [16, 50];

function scheduleDecisionLabel(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  toolCallId: string,
  isDisposed: () => boolean,
): void {
  const findEntryId = (): string | undefined => {
    const entries = ctx.sessionManager.getEntries();
    const entry = [...entries]
      .reverse()
      .find(
        (e) =>
          e.type === "message" &&
          e.message.role === "toolResult" &&
          e.message.toolCallId === toolCallId,
      );
    return entry?.id;
  };

  let retryIndex = 0;
  const attempt = () => {
    if (isDisposed()) return;
    try {
      const entryId = findEntryId();
      if (entryId !== undefined) {
        pi.setLabel(entryId, "decision");
        return;
      }
      const delay = DECISION_LABEL_RETRY_DELAYS_MS[retryIndex];
      if (delay !== undefined) {
        retryIndex += 1;
        setTimeout(attempt, delay);
      }
    } catch {
      // Labeling is best-effort; never throw into the timer.
    }
  };
  setTimeout(attempt, 0);
}

/**
 * Whether an interactive ask_user form can be shown: requires a UI and the TUI
 * mode. Every other mode (print, json, rpc, and SDK sessions) is headless —
 * the form cannot be rendered there even when a dialog-capable UI exists.
 */
export function canShowForm(hasUI: boolean, mode: string): boolean {
  return hasUI && mode === "tui";
}

let nextLockOwner = 0;

function signalAttention(ctx: AskUserExecutionContext, behavior: AskUserBehavior): void {
  signalWaiting(ctx, "pi — waiting for your input", { bell: behavior.bell });
}

function restoreTerminalTitle(ctx: AskUserExecutionContext, sessionName: string | undefined): void {
  ctx.ui.setTitle?.(formatTitle(sessionName, ctx.cwd));
}

function asFunction<T extends (...args: never[]) => unknown>(value: unknown): T | undefined {
  return typeof value === "function" ? (value as T) : undefined;
}
