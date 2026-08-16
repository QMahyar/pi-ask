import { describe, expect, it } from "vitest";
import {
  clampScroll,
  decodeKeyForCompare,
  formViewportHeight,
  nextFocusIndex,
  revealScroll,
} from "../src/ui/ui-logic.ts";

describe("decodeKeyForCompare", () => {
  it("passes through raw printable keys", () => {
    expect(decodeKeyForCompare("c")).toBe("c");
    expect(decodeKeyForCompare("u")).toBe("u");
    expect(decodeKeyForCompare("n")).toBe("n");
  });

  it("decodes Kitty CSI-u sequences for plain printable keys", () => {
    expect(decodeKeyForCompare("\x1b[99u")).toBe("c");
    expect(decodeKeyForCompare("\x1b[117u")).toBe("u");
    expect(decodeKeyForCompare("\x1b[110u")).toBe("n");
  });

  it("decodes Shift-modified Kitty CSI-u sequences", () => {
    expect(decodeKeyForCompare("\x1b[99:67;2u")).toBe("C");
  });

  it("leaves control and non-printable sequences unchanged", () => {
    expect(decodeKeyForCompare("\x1b[1;5u")).toBe("\x1b[1;5u");
    expect(decodeKeyForCompare("\x1b[99;3u")).toBe("\x1b[99;3u");
    expect(decodeKeyForCompare("\x1b[27u")).toBe("\x1b[27u");
    expect(decodeKeyForCompare("\x1b[A")).toBe("\x1b[A");
  });
});

describe("nextFocusIndex", () => {
  it("moves by the delta within bounds", () => {
    expect(nextFocusIndex(2, 1, 5)).toBe(3);
    expect(nextFocusIndex(2, -1, 5)).toBe(1);
    expect(nextFocusIndex(2, 5, 5)).toBe(5);
    expect(nextFocusIndex(2, -5, 5)).toBe(0);
  });

  it("clamps at the boundaries", () => {
    expect(nextFocusIndex(5, 1, 5)).toBe(5);
    expect(nextFocusIndex(0, -1, 5)).toBe(0);
    expect(nextFocusIndex(2, 0, 5)).toBe(2);
  });

  it("handles empty option lists", () => {
    expect(nextFocusIndex(0, 1, 0)).toBe(0);
    expect(nextFocusIndex(0, -1, 0)).toBe(0);
  });
});

describe("clampScroll", () => {
  it("keeps offsets inside the content", () => {
    expect(clampScroll(50, 100, 10)).toBe(50);
    expect(clampScroll(0, 100, 10)).toBe(0);
  });

  it("clamps beyond the content edges", () => {
    expect(clampScroll(95, 100, 10)).toBe(90);
    expect(clampScroll(-5, 100, 10)).toBe(0);
  });

  it("returns 0 when the content fits the viewport", () => {
    expect(clampScroll(20, 5, 10)).toBe(0);
    expect(clampScroll(0, 0, 10)).toBe(0);
  });
});

describe("revealScroll", () => {
  it("keeps a focus that is already visible", () => {
    expect(revealScroll(20, 25, 30, 100, 10)).toBe(20);
    expect(revealScroll(0, 0, 3, 100, 10)).toBe(0);
  });

  it("scrolls down to reveal a focus below the viewport", () => {
    expect(revealScroll(0, 50, 55, 100, 10)).toBe(45);
  });

  it("scrolls up to reveal a focus above the viewport", () => {
    expect(revealScroll(50, 5, 10, 100, 10)).toBe(5);
  });

  it("clamps reveal offsets to the content", () => {
    expect(revealScroll(0, 95, 100, 100, 10)).toBe(90);
    expect(revealScroll(90, 95, 100, 100, 10)).toBe(90);
  });

  it("does not scroll when the content fits", () => {
    expect(revealScroll(0, 2, 5, 5, 10)).toBe(0);
    expect(revealScroll(5, 2, 5, 5, 10)).toBe(0);
  });

  it("handles empty content and missing focus", () => {
    expect(revealScroll(0, 0, 0, 0, 10)).toBe(0);
    expect(revealScroll(50, 0, 0, 100, 10)).toBe(50);
  });
});

describe("formViewportHeight", () => {
  it("reserves dock chrome rows", () => {
    expect(formViewportHeight(24)).toBe(20);
    expect(formViewportHeight(10)).toBe(6);
  });

  it("floors at the host minSize", () => {
    expect(formViewportHeight(6)).toBe(3);
    expect(formViewportHeight(3)).toBe(3);
  });
});
