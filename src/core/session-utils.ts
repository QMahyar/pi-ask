// Session-name tracking on top of the pi API surface.

export interface SessionNameTrackerHost {
  on(event: string, handler: (...args: unknown[]) => unknown): void;
  getSessionName(): string | undefined;
}

/**
 * Create a reactive session-name tracker that stays consistent across
 * session starts, renames, and shutdowns without polling.
 *
 * Subscribes to `session_start` (initial name), `session_info_changed`
 * (renames via `/name`, `pi.setSessionName()`, or RPC), and
 * `session_shutdown` (reset to `undefined`).
 *
 * @returns a zero-arg getter that always returns the current session name
 *
 * @example
 * ```ts
 * const getSessionName = createSessionNameTracker(pi);
 * // …later, during tool execute or spinner rendering:
 * const name = getSessionName();
 * ```
 */
export function createSessionNameTracker(pi: SessionNameTrackerHost): () => string | undefined {
  let name: string | undefined;

  pi.on("session_start", () => {
    name = pi.getSessionName();
  });
  pi.on("session_info_changed", (event) => {
    name = (event as { name?: string }).name;
  });
  pi.on("session_shutdown", () => {
    name = undefined;
  });

  return () => name;
}
