import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import askUserExtension, {
  type AskUserExecutionContext,
  canShowForm,
  executeAskUser,
  shouldLabelDecision,
} from "../src/ask-user.ts";
import type { AskUserParams } from "../src/schema.ts";
import { ActiveQuestionnaireLock } from "../src/session/lock.ts";
import { ASK_USER_TOOL_NAME } from "../src/tool/guidance.ts";

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
