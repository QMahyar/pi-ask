import { describe, expect, it } from "vitest";
import { formatTitle } from "../src/core/terminal.ts";

describe("formatTitle", () => {
  it("formats the π title from session name and cwd basename", () => {
    expect(formatTitle("my-session", "/home/projects/foo")).toBe("π - my-session - foo");
  });

  it("falls back gracefully when session name or cwd is missing", () => {
    expect(formatTitle(undefined, "/home/projects/foo")).toBe("π - foo");
    expect(formatTitle("my-session")).toBe("π - my-session");
    expect(formatTitle()).toBe("π");
  });

  it("uses the cwd basename only, not the full path", () => {
    expect(formatTitle("s", "C:/Users/me/project")).toBe("π - s - project");
    expect(formatTitle("s", "/home/me/project")).toBe("π - s - project");
  });

  it("strips control characters from the cwd basename", () => {
    expect(formatTitle(undefined, "/tmp/evil\u001b]0;HACK\u0007dir")).toBe("π - evil]0;HACKdir");
    expect(formatTitle("s", "/tmp/evil\u001b[31m")).toBe("π - s - evil[31m");
  });

  it("strips carriage returns and bidi controls from the cwd basename", () => {
    expect(formatTitle(undefined, "/tmp/a\u000Db")).toBe("π - ab");
    expect(formatTitle(undefined, "/tmp/a\u202Eb\u200Fc\u061Cd")).toBe("π - abcd");
  });
});
