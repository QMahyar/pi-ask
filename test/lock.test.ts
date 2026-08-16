import { describe, expect, it } from "vitest";
import { ActiveQuestionnaireLock } from "../src/session/lock.ts";

describe("ActiveQuestionnaireLock", () => {
  it("acquires for a fresh owner", () => {
    const lock = new ActiveQuestionnaireLock();
    expect(lock.acquire("tool-1")).toBe(true);
    expect(lock.isLocked()).toBe(true);
    expect(lock.getOwner()).toBe("tool-1");
  });

  it("rejects a second acquisition while held", () => {
    const lock = new ActiveQuestionnaireLock();
    expect(lock.acquire("tool-1")).toBe(true);
    expect(lock.acquire("tool-2")).toBe(false);
    expect(lock.getOwner()).toBe("tool-1");
  });

  it("rejects acquiring with an empty owner", () => {
    const lock = new ActiveQuestionnaireLock();
    expect(lock.acquire("")).toBe(false);
    expect(lock.isLocked()).toBe(false);
  });

  it("release clears the lock only for the owning token", () => {
    const lock = new ActiveQuestionnaireLock();
    lock.acquire("tool-1");
    lock.release("stale");
    expect(lock.isLocked()).toBe(true);
    lock.release("tool-1");
    expect(lock.isLocked()).toBe(false);
  });

  it("releaseIfOwner returns whether it released", () => {
    const lock = new ActiveQuestionnaireLock();
    lock.acquire("tool-1");
    expect(lock.releaseIfOwner("stale")).toBe(false);
    expect(lock.isLocked()).toBe(true);
    expect(lock.releaseIfOwner("tool-1")).toBe(true);
    expect(lock.isLocked()).toBe(false);
    expect(lock.releaseIfOwner("tool-1")).toBe(false);
  });

  it("a stale release cannot clear a newer form's lock", () => {
    const lock = new ActiveQuestionnaireLock();
    lock.acquire("tool-1");
    lock.acquire("tool-2");
    lock.release("tool-1");
    expect(lock.isLocked()).toBe(false);
    lock.acquire("tool-2");
    lock.release("tool-1");
    expect(lock.isLocked()).toBe(true);
    expect(lock.getOwner()).toBe("tool-2");
  });

  it("can be reacquired after release", () => {
    const lock = new ActiveQuestionnaireLock();
    expect(lock.acquire("tool-1")).toBe(true);
    lock.release("tool-1");
    expect(lock.acquire("tool-2")).toBe(true);
    expect(lock.getOwner()).toBe("tool-2");
  });
});
