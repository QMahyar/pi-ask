import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import askUserExtension, {
  type AskUserExecutionContext,
  canShowForm,
  executeAskUser,
  shouldLabelDecision,
} from "../src/ask-user.ts";
import { AskUserValidationError } from "../src/normalize.ts";
import type { AskUserParams } from "../src/schema.ts";
import { ActiveQuestionnaireLock } from "../src/session/lock.ts";
import {
  ASK_USER_PROMPT_SURFACE_DEFAULTS,
  ASK_USER_TOOL_LABEL,
  ASK_USER_TOOL_NAME,
} from "../src/tool/guidance.ts";

function makeSubmittedParams(title?: string): AskUserParams {
  return {
    ...(title !== undefined ? { title } : {}),
    questions: [
      {
        type: "choice",
        id: "c1",
        header: "Pick",
        prompt: "Which one?",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
      },
    ],
  };
}

function submittedOutcome() {
  return {
    outcome: "submitted",
    responses: [
      {
        questionId: "c1",
        answer: {
          kind: "choice",
          answered: true,
          options: [{ value: "a", label: "A", selected: true }],
        },
      },
    ],
  };
}

describe("shouldLabelDecision", () => {
  it("labels a successful ask_user result", () => {
    expect(shouldLabelDecision("ask_user", false)).toBe(true);
  });

  it("does not label a failed, cancelled, or aborted ask_user result", () => {
    expect(shouldLabelDecision("ask_user", true)).toBe(false);
  });

  it("does not label results for other tools", () => {
    expect(shouldLabelDecision("bash", false)).toBe(false);
    expect(shouldLabelDecision("bash", true)).toBe(false);
  });
});

describe("herdr:blocked lifecycle events", () => {
  const BLOCKED = "herdr:blocked";

  type EmittedEvent = { name: string; data: unknown };

  function makePi(events: EmittedEvent[] = []) {
    const pi = {
      events: {
        emit: (name: string, data?: unknown) => {
          events.push({ name, data });
        },
      },
      appendEntry: vi.fn(),
      setLabel: vi.fn(),
      on: vi.fn(),
    };
    return { pi: pi as unknown as ExtensionAPI, events };
  }

  function makeCtx(
    options: { custom?: unknown; mode?: AskUserExecutionContext["mode"]; hasUI?: boolean } = {},
  ) {
    const ctx = {
      cwd: "/tmp",
      hasUI: options.hasUI ?? true,
      mode: options.mode ?? ("tui" as const),
      abort: vi.fn(),
      ui: {
        custom: options.custom,
        notify: vi.fn(),
        setWorkingVisible: vi.fn(),
        setTitle: vi.fn(),
      },
    };
    return ctx as unknown as AskUserExecutionContext;
  }

  function makeParams(title?: string): AskUserParams {
    return {
      ...(title !== undefined ? { title } : {}),
      questions: [
        {
          type: "choice",
          id: "c1",
          header: "Pick",
          prompt: "Which one?",
          options: [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
          ],
        },
      ],
    };
  }

  function submittedOutcome() {
    return {
      outcome: "submitted",
      responses: [
        {
          questionId: "c1",
          answer: {
            kind: "choice",
            answered: true,
            options: [{ value: "a", label: "A", selected: true }],
          },
        },
      ],
    };
  }

  const blockedEvents = (events: EmittedEvent[]) =>
    events.filter((event) => event.name === BLOCKED);

  it("emits herdr:blocked active:true with the form title on start, then active:false on submit", async () => {
    const { pi, events } = makePi();
    const ctx = makeCtx({ custom: async () => submittedOutcome() });
    const lock = new ActiveQuestionnaireLock();

    await executeAskUser(makeParams("Deploy decision"), undefined, ctx, lock, pi);

    expect(blockedEvents(events)).toEqual([
      { name: BLOCKED, data: { active: true, label: "Deploy decision" } },
      { name: BLOCKED, data: { active: false } },
    ]);
    expect(ctx.abort).not.toHaveBeenCalled();
    expect(lock.isLocked()).toBe(false);
  });

  it("falls back to the 'ask_user' label when the form has no title", async () => {
    const { pi, events } = makePi();
    const ctx = makeCtx({ custom: async () => submittedOutcome() });

    await executeAskUser(makeParams(), undefined, ctx, new ActiveQuestionnaireLock(), pi);

    expect(blockedEvents(events)[0]).toEqual({
      name: BLOCKED,
      data: { active: true, label: "ask_user" },
    });
  });

  it("keeps the existing pi-ask:ask-user:start/end events around the blocked events", async () => {
    const { pi, events } = makePi();
    const ctx = makeCtx({ custom: async () => submittedOutcome() });

    await executeAskUser(makeParams("Title"), undefined, ctx, new ActiveQuestionnaireLock(), pi);

    expect(events.map((event) => event.name)).toEqual([
      "pi-ask:ask-user:start",
      BLOCKED,
      "pi-ask:ask-user:end",
      BLOCKED,
    ]);
    expect(events[0].data).toEqual({ source: "pi-ask" });
    expect(events[2].data).toEqual({ source: "pi-ask" });
  });

  it("emits herdr:blocked active:false when the user cancels (Esc)", async () => {
    const { pi, events } = makePi();
    const ctx = makeCtx({ custom: async () => ({ kind: "cancel" }) });

    await expect(
      executeAskUser(makeParams(), undefined, ctx, new ActiveQuestionnaireLock(), pi),
    ).rejects.toThrow("The user interaction was cancelled.");

    expect(blockedEvents(events)).toEqual([
      { name: BLOCKED, data: { active: true, label: "ask_user" } },
      { name: BLOCKED, data: { active: false } },
    ]);
    expect(ctx.abort).toHaveBeenCalledTimes(1);
  });

  it("emits herdr:blocked active:false when the run is aborted before the form opens", async () => {
    const { pi, events } = makePi();
    const ctx = makeCtx({ custom: vi.fn() });
    const controller = new AbortController();
    controller.abort();

    await expect(
      executeAskUser(makeParams(), controller.signal, ctx, new ActiveQuestionnaireLock(), pi),
    ).rejects.toThrow("The user interaction was aborted.");

    expect(ctx.ui.custom).not.toHaveBeenCalled();
    expect(blockedEvents(events)).toEqual([
      { name: BLOCKED, data: { active: true, label: "ask_user" } },
      { name: BLOCKED, data: { active: false } },
    ]);
  });

  it("emits herdr:blocked active:false when the session aborts while the form is open", async () => {
    const { pi, events } = makePi();
    const controller = new AbortController();
    const ctx = makeCtx({
      custom: (_mount: unknown) =>
        new Promise((resolve) => {
          controller.signal.addEventListener("abort", () => resolve({ kind: "abort" }), {
            once: true,
          });
        }),
    });
    const lock = new ActiveQuestionnaireLock();

    const run = executeAskUser(makeParams(), controller.signal, ctx, lock, pi);
    controller.abort();

    await expect(run).rejects.toThrow("The user interaction was aborted.");
    expect(blockedEvents(events)).toEqual([
      { name: BLOCKED, data: { active: true, label: "ask_user" } },
      { name: BLOCKED, data: { active: false } },
    ]);
    expect(lock.isLocked()).toBe(false);
  });

  it("emits herdr:blocked active:false when the form run throws", async () => {
    const { pi, events } = makePi();
    const ctx = makeCtx({
      custom: async () => {
        throw new Error("renderer exploded");
      },
    });
    const lock = new ActiveQuestionnaireLock();

    await expect(executeAskUser(makeParams(), undefined, ctx, lock, pi)).rejects.toThrow(
      "renderer exploded",
    );

    expect(blockedEvents(events)).toEqual([
      { name: BLOCKED, data: { active: true, label: "ask_user" } },
      { name: BLOCKED, data: { active: false } },
    ]);
    expect(lock.isLocked()).toBe(false);
  });

  it("emits no herdr:blocked events in headless modes", async () => {
    const { pi, events } = makePi();
    const ctx = makeCtx({ custom: vi.fn(), mode: "print", hasUI: false });

    await expect(
      executeAskUser(makeParams(), undefined, ctx, new ActiveQuestionnaireLock(), pi),
    ).rejects.toThrow(/requires an interactive TUI session/);

    expect(events).toEqual([]);
  });
});

describe("session_shutdown lock release", () => {
  type CapturedTool = {
    name: string;
    execute: (
      toolCallId: string,
      params: AskUserParams,
      signal: AbortSignal | undefined,
      onUpdate: unknown,
      ctx: AskUserExecutionContext,
    ) => Promise<unknown>;
  };

  function makeExtensionPi() {
    const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();
    const tools: CapturedTool[] = [];
    const pi = {
      on: (name: string, handler: (...args: unknown[]) => unknown) => {
        const list = handlers.get(name) ?? [];
        list.push(handler);
        handlers.set(name, list);
      },
      registerTool: (desc: CapturedTool) => {
        tools.push(desc);
      },
      registerEntryRenderer: vi.fn(),
      appendEntry: vi.fn(),
      setLabel: vi.fn(),
      events: { emit: vi.fn() },
    };
    return { pi: pi as unknown as ExtensionAPI, handlers, tools };
  }

  function makeCtx(custom: unknown): AskUserExecutionContext {
    return {
      cwd: "/tmp",
      hasUI: true,
      mode: "tui",
      abort: vi.fn(),
      ui: {
        custom,
        notify: vi.fn(),
        setWorkingVisible: vi.fn(),
        setTitle: vi.fn(),
      },
    } as unknown as AskUserExecutionContext;
  }

  function makeParams(title?: string): AskUserParams {
    return {
      ...(title !== undefined ? { title } : {}),
      questions: [
        {
          type: "choice",
          id: "c1",
          header: "Pick",
          prompt: "Which one?",
          options: [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
          ],
        },
      ],
    };
  }

  it("releases a hung in-flight form lock so later sessions can call ask_user again", async () => {
    const { pi, handlers, tools } = makeExtensionPi();
    askUserExtension(pi);

    const shutdownHandlers = handlers.get("session_shutdown") ?? [];
    expect(shutdownHandlers.length).toBeGreaterThan(0);
    const registeredTool = tools.find((t) => t.name === ASK_USER_TOOL_NAME);
    expect(registeredTool).toBeDefined();
    const tool = registeredTool as CapturedTool;

    // First session: a form that never completes holds the lock.
    let resolveGate!: (value: unknown) => void;
    const gate = new Promise((resolve) => {
      resolveGate = resolve;
    });
    const ctx1 = makeCtx(() => gate);
    const run1 = tool.execute("tool-1", makeParams("Form 1"), undefined, undefined, ctx1);

    // The lock is genuinely held while the form is in flight.
    await expect(
      tool.execute("blocked", makeParams("Blocked"), undefined, undefined, makeCtx(vi.fn())),
    ).rejects.toThrow("another ask_user form is already in flight.");

    // session_shutdown releases the in-flight lock.
    for (const handler of shutdownHandlers) handler();

    // A later session in the same process can now acquire the lock again.
    const ctx2 = makeCtx(async () => ({
      outcome: "submitted",
      responses: [
        {
          questionId: "c1",
          answer: {
            kind: "choice",
            answered: true,
            options: [{ value: "a", label: "A", selected: true }],
          },
        },
      ],
    }));
    await tool.execute("tool-2", makeParams("Form 2"), undefined, undefined, ctx2);

    // The hung form from the first session can still settle (release is a no-op).
    resolveGate({ kind: "cancel" });
    await expect(run1).rejects.toThrow("The user interaction was cancelled.");
  });
});

describe("askUserExtension lifecycle", () => {
  type Handler = (...args: unknown[]) => unknown;

  function makeExtensionPi() {
    const handlers = new Map<string, Handler[]>();
    const tools: Array<{ name: string; label?: string; description: string }> = [];
    const pi = {
      on: (name: string, handler: Handler) => {
        const list = handlers.get(name) ?? [];
        list.push(handler);
        handlers.set(name, list);
      },
      registerTool: (desc: { name: string; label?: string; description: string }) => {
        tools.push(desc);
      },
      registerEntryRenderer: vi.fn(),
      appendEntry: vi.fn(),
      setLabel: vi.fn(),
      getSessionName: () => undefined,
      events: { emit: vi.fn() },
    };
    return { pi: pi as unknown as ExtensionAPI, handlers, tools };
  }

  function entry(toolCallId: string, id: string) {
    return { type: "message", id, message: { role: "toolResult", toolCallId } };
  }

  const flushTimers = () => new Promise((resolve) => setTimeout(resolve, 10));

  it("registers the tool, the entry renderer, and its event subscriptions at factory time", () => {
    const { pi, handlers, tools } = makeExtensionPi();
    askUserExtension(pi);

    const tool = tools.find((t) => t.name === ASK_USER_TOOL_NAME);
    expect(tool).toBeDefined();
    expect(tool?.label).toBe(ASK_USER_TOOL_LABEL);
    expect(tool?.description).toBe(ASK_USER_PROMPT_SURFACE_DEFAULTS.description);
    expect(pi.registerEntryRenderer).toHaveBeenCalledWith("ask_user", expect.any(Function));
    for (const event of ["session_shutdown", "tool_result", "session_start"]) {
      expect(handlers.get(event)?.length).toBeGreaterThan(0);
    }
  });

  it("labels successful ask_user results with setLabel('decision') from the deferred callback", async () => {
    const { pi, handlers } = makeExtensionPi();
    askUserExtension(pi);

    const handler = handlers.get("tool_result")![0];
    handler(
      { toolName: ASK_USER_TOOL_NAME, toolCallId: "tc-1", isError: false },
      { sessionManager: { getEntries: () => [entry("tc-1", "entry-1")] } },
    );
    await flushTimers();
    expect(pi.setLabel).toHaveBeenCalledWith("entry-1", "decision");
  });

  it("finds the newest matching toolResult entry when older ones exist", async () => {
    const { pi, handlers } = makeExtensionPi();
    askUserExtension(pi);

    const handler = handlers.get("tool_result")![0];
    // getEntries() is oldest-first; the reverse search must find the LAST match.
    handler(
      { toolName: ASK_USER_TOOL_NAME, toolCallId: "tc-9", isError: false },
      {
        sessionManager: {
          getEntries: () => [
            entry("tc-9", "entry-old"),
            entry("tc-other", "entry-other"),
            entry("tc-9", "entry-new"),
          ],
        },
      },
    );
    await flushTimers();
    expect(pi.setLabel).toHaveBeenCalledWith("entry-new", "decision");
  });

  it("does not label errored results, other tools, or unmatched call ids", async () => {
    const { pi, handlers } = makeExtensionPi();
    askUserExtension(pi);

    const handler = handlers.get("tool_result")![0];
    const ctx = { sessionManager: { getEntries: () => [entry("tc-1", "entry-1")] } };
    handler({ toolName: ASK_USER_TOOL_NAME, toolCallId: "tc-1", isError: true }, ctx);
    handler({ toolName: "bash", toolCallId: "tc-1", isError: false }, ctx);
    handler({ toolName: ASK_USER_TOOL_NAME, toolCallId: "tc-missing", isError: false }, ctx);
    await flushTimers();
    expect(pi.setLabel).not.toHaveBeenCalled();
  });

  it("skips labeling after session_shutdown disposal", async () => {
    const { pi, handlers } = makeExtensionPi();
    askUserExtension(pi);

    for (const handler of handlers.get("session_shutdown") ?? []) handler();
    handlers.get("tool_result")![0](
      { toolName: ASK_USER_TOOL_NAME, toolCallId: "tc-1", isError: false },
      { sessionManager: { getEntries: () => [entry("tc-1", "entry-1")] } },
    );
    await flushTimers();
    expect(pi.setLabel).not.toHaveBeenCalled();
  });

  it("keeps labeling best-effort when getEntries or lookup throws", async () => {
    const { pi, handlers } = makeExtensionPi();
    askUserExtension(pi);

    const handler = handlers.get("tool_result")![0];
    handler(
      { toolName: ASK_USER_TOOL_NAME, toolCallId: "tc-1", isError: false },
      { sessionManager: { getEntries: () => {
        throw new Error("boom");
      } } },
    );
    await flushTimers();
    expect(pi.setLabel).not.toHaveBeenCalled();
  });

  it("session_start re-registers the tool with the resolved prompt surface", async () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), "pi-ask-ext-"));
    try {
      mkdirSync(path.join(fixtureRoot, "pi-ask"), { recursive: true });
      writeFileSync(
        path.join(fixtureRoot, "pi-ask", "config.json"),
        JSON.stringify({
          "ask-user": {
            tools: { ask_user: { promptSurface: { description: "session description" } } },
          },
        }),
      );

      const previous = process.env.PI_CODING_AGENT_DIR;
      process.env.PI_CODING_AGENT_DIR = fixtureRoot;
      try {
        const { pi, handlers, tools } = makeExtensionPi();
        const notify = vi.fn();
        askUserExtension(pi);
        const initialCount = tools.length;

        // createSessionNameTracker registers a session_start handler too; the
        // extension's re-registration handler is the last one.
        const sessionStart = handlers.get("session_start")!.at(-1)!;
        await sessionStart(
          {},
          {
            cwd: fixtureRoot,
            isProjectTrusted: () => false,
            sessionManager: { getSessionId: () => "session-1" },
            ui: { notify },
          },
        );

        expect(tools.length).toBe(initialCount + 1);
        const reRegistered = tools[tools.length - 1];
        expect(reRegistered.name).toBe(ASK_USER_TOOL_NAME);
        expect(reRegistered.description).toBe("session description");
        expect(notify).not.toHaveBeenCalled();
      } finally {
        if (previous === undefined) {
          delete process.env.PI_CODING_AGENT_DIR;
        } else {
          process.env.PI_CODING_AGENT_DIR = previous;
        }
      }
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});

describe("executeAskUser error paths and side effects", () => {
  function makeCtx(custom: unknown, opts: { sessionName?: string } = {}) {
    const ctx = {
      cwd: "/tmp",
      hasUI: true,
      mode: "tui" as const,
      abort: vi.fn(),
      ui: {
        custom,
        notify: vi.fn(),
        setWorkingVisible: vi.fn(),
        setTitle: vi.fn(),
      },
    };
    return { ctx: ctx as unknown as AskUserExecutionContext, ...opts };
  }

  function makePi() {
    const pi = { events: { emit: vi.fn() }, appendEntry: vi.fn(), setLabel: vi.fn(), on: vi.fn() };
    return pi as unknown as ExtensionAPI;
  }

  it("throws the custom-UI error when the ui has no form-capable custom hook", async () => {
    const { ctx } = makeCtx("not a function");
    const lock = new ActiveQuestionnaireLock();

    await expect(
      executeAskUser(makeSubmittedParams(), undefined, ctx, lock, makePi()),
    ).rejects.toThrow("ask_user requires a TUI with custom form support");
    expect(lock.isLocked()).toBe(false);
  });

  it("throws the custom-UI error when the form run reports 'unsupported'", async () => {
    const { ctx } = makeCtx(async () => "unsupported");
    const lock = new ActiveQuestionnaireLock();

    await expect(
      executeAskUser(makeSubmittedParams(), undefined, ctx, lock, makePi()),
    ).rejects.toThrow("ask_user requires a TUI with custom form support");
    expect(lock.isLocked()).toBe(false);
  });

  it("wraps validation errors with the original as cause", async () => {
    const { ctx } = makeCtx(vi.fn());
    const params: AskUserParams = {
      questions: Array.from({ length: 11 }, (_, i) => ({
        type: "text" as const,
        id: `t${i}`,
        header: `H${i}`,
        prompt: "P?",
      })),
    };

    await expect(executeAskUser(params, undefined, ctx, new ActiveQuestionnaireLock(), makePi())).rejects.toMatchObject({
      message: expect.stringMatching(/1-10 questions/),
      cause: expect.any(AskUserValidationError),
    });
  });

  it("appends the ask_user entry with title and question count on submit", async () => {
    const pi = makePi();
    const { ctx } = makeCtx(async () => submittedOutcome());

    const result = await executeAskUser(
      makeSubmittedParams("Deploy decision"),
      undefined,
      ctx,
      new ActiveQuestionnaireLock(),
      pi,
    );
    expect(pi.appendEntry).toHaveBeenCalledWith("ask_user", {
      title: "Deploy decision",
      questions: 1,
    });
    expect(result.content[0]?.type).toBe("text");
    expect(
      result.content.find((c) => c.type === "text")?.text,
    ).toContain("Pick: A");
  });

  it("toggles working visibility and restores the terminal title around the run", async () => {
    const pi = makePi();
    const { ctx } = makeCtx(async () => submittedOutcome(), { sessionName: "my-session" });

    await executeAskUser(
      makeSubmittedParams(),
      undefined,
      ctx,
      new ActiveQuestionnaireLock(),
      pi,
      "my-session",
    );

    expect(ctx.ui.setWorkingVisible).toHaveBeenNthCalledWith(1, false);
    expect(ctx.ui.setWorkingVisible).toHaveBeenNthCalledWith(2, true);
    expect(ctx.ui.setTitle).toHaveBeenNthCalledWith(1, "●  pi — waiting for your input");
    expect(ctx.ui.setTitle).toHaveBeenNthCalledWith(2, "π - my-session - tmp");
  });

  it("restores a title without session name when none is known", async () => {
    const pi = makePi();
    const { ctx } = makeCtx(async () => submittedOutcome());

    await executeAskUser(makeSubmittedParams(), undefined, ctx, new ActiveQuestionnaireLock(), pi);
    expect(ctx.ui.setTitle).toHaveBeenLastCalledWith("π - tmp");
  });

  it("releases the lock and restores the working state when validation fails", async () => {
    const pi = makePi();
    const { ctx } = makeCtx(vi.fn());
    const lock = new ActiveQuestionnaireLock();

    await expect(
      executeAskUser({ questions: [] }, undefined, ctx, lock, pi),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/1-10 questions/),
      cause: expect.any(AskUserValidationError),
    });
    // Validation fails before the lock is acquired; nothing to release.
    expect(lock.isLocked()).toBe(false);
  });

  it("rejects the second call while a form is in flight and keeps the lock held", async () => {
    let resolveRun!: (value: unknown) => void;
    const gate = new Promise((resolve) => {
      resolveRun = resolve;
    });
    const { ctx } = makeCtx(() => gate);
    const lock = new ActiveQuestionnaireLock();
    const pi = makePi();

    const first = executeAskUser(makeSubmittedParams(), undefined, ctx, lock, pi, undefined, "owner-1");
    await expect(
      executeAskUser(makeSubmittedParams(), undefined, ctx, lock, pi, undefined, "owner-2"),
    ).rejects.toThrow("another ask_user form is already in flight");
    expect(lock.isLocked()).toBe(true);

    resolveRun(submittedOutcome());
    await first;
    expect(lock.isLocked()).toBe(false);
  });

  it("releases the lock and emits end events when the form run throws", async () => {
    const pi = makePi();
    const { ctx } = makeCtx(async () => {
      throw new Error("renderer exploded");
    });
    const lock = new ActiveQuestionnaireLock();

    await expect(
      executeAskUser(makeSubmittedParams(), undefined, ctx, lock, pi, undefined, "owner-3"),
    ).rejects.toThrow("renderer exploded");
    expect(lock.isLocked()).toBe(false);
    expect(pi.events.emit).toHaveBeenCalledWith("pi-ask:ask-user:end", { source: "pi-ask" });
  });

  it("skips terminal restore for a ctx without a title setter", async () => {
    const ctx = {
      cwd: "/tmp",
      hasUI: true,
      mode: "tui" as const,
      abort: vi.fn(),
      ui: { custom: async () => submittedOutcome(), setWorkingVisible: vi.fn() },
    } as unknown as AskUserExecutionContext;

    await expect(
      executeAskUser(makeSubmittedParams(), undefined, ctx, new ActiveQuestionnaireLock(), makePi()),
    ).resolves.toBeDefined();
    expect(ctx.ui.setTitle).toBeUndefined();
  });
});

describe("canShowForm", () => {
  it("allows the TUI mode with a UI", () => {
    expect(canShowForm(true, "tui")).toBe(true);
  });

  it("rejects RPC even though it has a dialog-capable UI", () => {
    expect(canShowForm(true, "rpc")).toBe(false);
  });

  it("rejects print mode", () => {
    expect(canShowForm(false, "print")).toBe(false);
  });

  it("rejects json mode", () => {
    expect(canShowForm(false, "json")).toBe(false);
  });

  it("rejects the SDK default headless context (no UI context, runner default mode)", () => {
    expect(canShowForm(false, "print")).toBe(false);
  });

  it("rejects TUI mode without a UI", () => {
    expect(canShowForm(false, "tui")).toBe(false);
  });
});
