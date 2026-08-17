import { describe, expect, it, vi } from "vitest";
import { createSessionNameTracker } from "../src/core/session-utils.ts";

type Handler = (event?: unknown) => void;

function makeHost() {
  const handlers = new Map<string, Handler[]>();
  let sessionName = "session-a";
  const host = {
    on: (event: string, handler: Handler) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    getSessionName: vi.fn(() => sessionName),
    setName: (name: string | undefined) => {
      sessionName = name ?? "session-a";
    },
  };
  return { host, handlers };
}

function fire(handlers: Map<string, Handler[]>, event: string, payload?: unknown) {
  for (const handler of handlers.get(event) ?? []) handler(payload);
}

describe("createSessionNameTracker", () => {
  it("returns undefined before any session event", () => {
    const { host } = makeHost();
    const getSessionName = createSessionNameTracker(host);
    expect(getSessionName()).toBeUndefined();
  });

  it("captures the session name on session_start", () => {
    const { host, handlers } = makeHost();
    host.setName("session-b");
    const getSessionName = createSessionNameTracker(host);
    fire(handlers, "session_start");
    expect(getSessionName()).toBe("session-b");
    expect(host.getSessionName).toHaveBeenCalledTimes(1);
  });

  it("follows renames via session_info_changed", () => {
    const { host, handlers } = makeHost();
    const getSessionName = createSessionNameTracker(host);
    fire(handlers, "session_start");
    fire(handlers, "session_info_changed", { name: "renamed-session" });
    expect(getSessionName()).toBe("renamed-session");
  });

  it("clears the name on session_shutdown", () => {
    const { host, handlers } = makeHost();
    const getSessionName = createSessionNameTracker(host);
    fire(handlers, "session_start");
    fire(handlers, "session_shutdown");
    expect(getSessionName()).toBeUndefined();
  });

  it("subscribes to all three lifecycle events exactly once", () => {
    const { host, handlers } = makeHost();
    createSessionNameTracker(host);
    expect(handlers.get("session_start")?.length).toBe(1);
    expect(handlers.get("session_info_changed")?.length).toBe(1);
    expect(handlers.get("session_shutdown")?.length).toBe(1);
  });

  it("tracks the full lifecycle: start → rename → shutdown → start", () => {
    const { host, handlers } = makeHost();
    const getSessionName = createSessionNameTracker(host);

    fire(handlers, "session_start");
    expect(getSessionName()).toBe("session-a");

    fire(handlers, "session_info_changed", { name: "renamed" });
    expect(getSessionName()).toBe("renamed");

    fire(handlers, "session_shutdown");
    expect(getSessionName()).toBeUndefined();

    host.setName("session-c");
    fire(handlers, "session_start");
    expect(getSessionName()).toBe("session-c");
  });

  it("treats an undefined rename as clearing the name", () => {
    const { host, handlers } = makeHost();
    const getSessionName = createSessionNameTracker(host);
    fire(handlers, "session_start");
    fire(handlers, "session_info_changed", { name: undefined });
    expect(getSessionName()).toBeUndefined();
  });
});
