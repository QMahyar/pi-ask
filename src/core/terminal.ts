/**
 * Shared terminal title formatting and signaling utilities.
 *
 * Centralized place for pi title convention (π prefix) and the waiting (●)
 * indicator, plus the audible terminal bell.
 */
import path from "node:path";
import { normalizeDisplayText } from "../normalize.ts";

/** Unicode dot shown when waiting for user input. */
const WAITING_SYMBOL = "\u25CF";

/** Minimal UI surface needed for title operations. */
export interface TitleTarget {
  ui: {
    setTitle?(title: string): void;
  };
}

/** Options for the waiting signal. */
export interface WaitingSignalOptions {
  /** Sound the audible bell. Default: true. */
  bell?: boolean;
}

/**
 * Format pi's canonical terminal title from session name and cwd.
 * Falls back gracefully when either is missing.
 *
 * @example
 *   formatTitle("my-session", "/home/projects/foo")  // "π - my-session - foo"
 *   formatTitle(undefined, "/home/projects/foo")      // "π - foo"
 *   formatTitle("my-session")                         // "π - my-session"
 *   formatTitle()                                     // "π"
 */
export function formatTitle(sessionName?: string, cwd?: string): string {
  // A directory may legally contain ESC/control bytes on POSIX; sanitize the
  // basename before it reaches the terminal title (OSC) write.
  const base = cwd ? normalizeDisplayText(path.basename(cwd)) : undefined;
  if (sessionName && base) return `π - ${sessionName} - ${base}`;
  if (sessionName) return `π - ${sessionName}`;
  if (base) return `π - ${base}`;
  return "π";
}

/** Sound the audible terminal bell (ASCII BEL). */
function signalBell(): void {
  process.stdout.write("\x07");
}

/**
 * Set the terminal title to indicate the agent is waiting for user input.
 * Prefixes with ● and (unless disabled) sounds the terminal bell.
 */
export function signalWaiting(
  ctx: TitleTarget,
  title: string,
  options: WaitingSignalOptions = {},
): void {
  ctx.ui.setTitle?.(`${WAITING_SYMBOL}  ${title}`);
  if (options.bell !== false) signalBell();
}
