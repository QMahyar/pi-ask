import type { AgentToolResult, Theme } from "@earendil-works/pi-coding-agent";
import type { Text } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { renderAskUserCall, renderAskUserResult } from "../src/render/transcript.ts";
import type { AskUserParams } from "../src/schema.ts";
import type { AskUserToolDetails } from "../src/types.ts";

// A theme stub that passes text through verbatim (no ANSI styling), so
// assertions on the rendered output can distinguish injected control bytes
// from legitimate theme styling.
const plainTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

type RenderResult = Pick<AgentToolResult<AskUserToolDetails>, "content" | "details">;

function textResult(text: string): RenderResult {
  return {
    content: [{ type: "text", text }],
    details: undefined as unknown as AskUserToolDetails,
  };
}

function renderText(text: Text): string {
  return text.render(500).join("\n");
}

describe("renderAskUserCall", () => {
  it("renders a valid call with title and headers", () => {
    const call = renderAskUserCall(
      {
        title: "Deploy",
        questions: [
          { type: "choice", id: "c", header: "Pick", prompt: "Which?", options: [] },
          { type: "text", id: "t", header: "Notes", prompt: "Anything?" },
        ],
      } as AskUserParams,
      plainTheme,
    );
    expect(renderText(call)).toContain("Deploy");
    expect(renderText(call)).toContain("Pick");
    expect(renderText(call)).toContain("Notes");
  });

  it("does not throw on a non-string title during streaming", () => {
    const call = renderAskUserCall(
      { title: 42, questions: [] } as unknown as AskUserParams,
      plainTheme,
    );
    expect(renderText(call)).toContain("ask_user");
  });

  it("does not throw on a non-string header during streaming", () => {
    const call = renderAskUserCall(
      {
        questions: [{ type: "text", id: "t", header: 42, prompt: "P?" }],
      } as unknown as AskUserParams,
      plainTheme,
    );
    const text = renderText(call);
    expect(text).toContain("ask_user");
    expect(text).not.toContain("42");
  });

  it("does not throw on null or primitive question entries", () => {
    const call = renderAskUserCall(
      { questions: [null, "junk"] } as unknown as AskUserParams,
      plainTheme,
    );
    expect(renderText(call)).toContain("ask_user");
  });

  it("does not throw on null args or incomplete args", () => {
    expect(renderText(renderAskUserCall(null as unknown as AskUserParams, plainTheme))).toContain(
      "ask_user",
    );
    expect(
      renderText(renderAskUserCall({} as AskUserParams, plainTheme, { argsComplete: false })),
    ).toContain("ask_user");
  });

  it("sanitizes control characters in streamed headers", () => {
    const call = renderAskUserCall(
      {
        questions: [{ type: "text", id: "t", header: "Bad\u001b[31mHeader", prompt: "P?" }],
      } as unknown as AskUserParams,
      plainTheme,
    );
    const text = renderText(call);
    expect(text).not.toContain("\u001b");
    expect(text).toContain("Bad[31mHeader");
  });
});

describe("renderAskUserResult defense-in-depth sanitization", () => {
  it("strips control characters from error result text", () => {
    const out = renderAskUserResult(
      textResult('Duplicate question id "a\u001b[31m"'),
      plainTheme,
      {},
      { isError: true },
    );
    const text = renderText(out);
    expect(text).not.toContain("\u001b");
    expect(text).toContain('Duplicate question id "a[31m"');
  });

  it("strips OSC and clear-screen escapes from partial result text", () => {
    const out = renderAskUserResult(
      textResult("pending\u001b]0;EVIL\u0007\u001b[2J\u001b[H"),
      plainTheme,
      { isPartial: true },
    );
    const text = renderText(out);
    expect(text).not.toContain("\u001b");
    expect(text).not.toContain("\u0007");
    expect(text).toContain("pending]0;EVIL[2J[H");
  });

  it("falls back for an error result with no text content", () => {
    const out = renderAskUserResult(
      { content: [], details: undefined as unknown as AskUserToolDetails },
      plainTheme,
      {},
      { isError: true },
    );
    expect(renderText(out)).toContain("ask_user failed.");
  });
});
