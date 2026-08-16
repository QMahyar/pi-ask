import { decodeKittyPrintable } from "@earendil-works/pi-tui";

/** Terminal rows reserved for pi's dock chrome (transcript, footer, status). */
export const FORM_VIEWPORT_RESERVE = 4;

/** List page size for PageUp/PageDown focus jumps. */
export const FORM_LIST_PAGE_SIZE = 5;

/**
 * Decode a key event into a printable character when possible, so plain-letter
 * shortcuts work under the Kitty keyboard protocol (CSI-u) and modifyOtherKeys.
 */
export function decodeKeyForCompare(data: string): string {
  return decodeKittyPrintable(data) ?? data;
}

/** Clamp a focus index to the valid range [0, maxIndex]. */
export function nextFocusIndex(current: number, delta: number, maxIndex: number): number {
  return Math.min(Math.max(0, current + delta), Math.max(0, maxIndex));
}

/** Clamp a line-based scroll offset so the viewport stays inside the content. */
export function clampScroll(
  scrollOffset: number,
  contentHeight: number,
  viewportHeight: number,
): number {
  const maxOffset = Math.max(0, contentHeight - Math.max(0, viewportHeight));
  return Math.min(Math.max(0, scrollOffset), maxOffset);
}

/**
 * Adjust a scroll offset so the [focusStart, focusEnd) line range stays visible.
 * Returns the offset clamped to the content.
 */
export function revealScroll(
  scrollOffset: number,
  focusStart: number,
  focusEnd: number,
  contentHeight: number,
  viewportHeight: number,
): number {
  const viewport = Math.max(1, viewportHeight);
  const offset = clampScroll(scrollOffset, contentHeight, viewport);
  if (contentHeight === 0 || focusEnd <= focusStart) return offset;
  if (focusStart < offset) return clampScroll(focusStart, contentHeight, viewport);
  if (focusEnd > offset + viewport) {
    return clampScroll(Math.max(0, focusEnd - viewport), contentHeight, viewport);
  }
  return offset;
}

/** Terminal rows the form may occupy, mirroring the host's minSize of 3. */
export function formViewportHeight(
  terminalRows: number,
  reserve: number = FORM_VIEWPORT_RESERVE,
): number {
  return Math.max(3, terminalRows - reserve);
}
