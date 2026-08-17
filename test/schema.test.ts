import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";
import { AskUserParamsSchema } from "../src/schema.ts";

const validParams = {
  title: "Decide",
  intro: "We need a decision before scaffolding.",
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
      recommendation: ["a"],
    },
    {
      type: "text",
      id: "t1",
      header: "Notes",
      prompt: "Anything else?",
    },
  ],
};

describe("AskUserParamsSchema", () => {
  it("accepts a valid payload", () => {
    expect(Check(AskUserParamsSchema, validParams)).toBe(true);
  });

  it("rejects an over-limit payload (11 questions)", () => {
    const overLimit = {
      questions: Array.from({ length: 11 }, (_, i) => ({
        type: "text",
        id: `t${i}`,
        header: `H${i}`,
        prompt: "P?",
      })),
    };
    expect(Check(AskUserParamsSchema, overLimit)).toBe(false);
  });

  it("rejects an under-limit option count (1 option)", () => {
    const bad = {
      questions: [
        {
          type: "choice",
          id: "c",
          header: "C",
          prompt: "P?",
          options: [{ value: "a", label: "A" }],
        },
      ],
    };
    expect(Check(AskUserParamsSchema, bad)).toBe(false);
  });

  it("rejects an over-limit recommendation array (13 entries)", () => {
    const bad = {
      questions: [
        {
          type: "choice",
          id: "c",
          header: "C",
          prompt: "P?",
          options: [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
          ],
          recommendation: Array.from({ length: 13 }, (_, i) => `v${i}`),
        },
      ],
    };
    expect(Check(AskUserParamsSchema, bad)).toBe(false);
  });

  it("accepts a recommendation array at the 12-entry limit", () => {
    const ok = {
      questions: [
        {
          type: "choice",
          id: "c",
          header: "C",
          prompt: "P?",
          options: Array.from({ length: 12 }, (_, i) => ({ value: `v${i}`, label: `V${i}` })),
          recommendation: Array.from({ length: 12 }, (_, i) => `v${i}`),
        },
      ],
    };
    expect(Check(AskUserParamsSchema, ok)).toBe(true);
  });

  it("rejects an unknown question type", () => {
    const bad = { questions: [{ type: "radio", id: "c", header: "C", prompt: "P?" }] };
    expect(Check(AskUserParamsSchema, bad)).toBe(false);
  });

  it("accepts the flattened shape: options on a text question pass the schema (normalize rejects them)", () => {
    const flattened = {
      questions: [
        {
          type: "text",
          id: "t",
          header: "C",
          prompt: "P?",
          options: [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
          ],
        },
      ],
    };
    expect(Check(AskUserParamsSchema, flattened)).toBe(true);
  });
});

describe("AskUserParamsSchema boundaries", () => {
  function textQuestion(id: string) {
    return { type: "text", id, header: `H${id}`, prompt: "P?" };
  }

  function choiceWith(count: number) {
    return {
      type: "choice",
      id: "c",
      header: "C",
      prompt: "P?",
      options: Array.from({ length: count }, (_, i) => ({ value: `v${i}`, label: `L${i}` })),
    };
  }

  it("accepts exactly 10 questions", () => {
    expect(
      Check(AskUserParamsSchema, {
        questions: Array.from({ length: 10 }, (_, i) => textQuestion(`t${i}`)),
      }),
    ).toBe(true);
  });

  it("accepts exactly 12 options on a choice question", () => {
    expect(Check(AskUserParamsSchema, { questions: [choiceWith(12)] })).toBe(true);
  });

  it("rejects 13 options", () => {
    expect(Check(AskUserParamsSchema, { questions: [choiceWith(13)] })).toBe(false);
  });

  it("rejects an empty questions array", () => {
    expect(Check(AskUserParamsSchema, { questions: [] })).toBe(false);
  });

  it("rejects a non-array questions field", () => {
    expect(Check(AskUserParamsSchema, { questions: "nope" })).toBe(false);
    expect(Check(AskUserParamsSchema, {})).toBe(false);
  });

  it("accepts empty-string title, header, prompt, and option fields (normalize rejects them later)", () => {
    expect(
      Check(AskUserParamsSchema, {
        title: "",
        intro: "",
        questions: [
          {
            type: "text",
            id: "",
            header: "",
            prompt: "",
            placeholder: "",
          },
        ],
      }),
    ).toBe(true);
    expect(
      Check(AskUserParamsSchema, {
        questions: [
          {
            type: "choice",
            id: "c",
            header: "",
            prompt: "",
            options: [
              { value: "", label: "" },
              { value: "b", label: "B", description: "", details: "" },
            ],
          },
        ],
      }),
    ).toBe(true);
  });

  it("types multi as a boolean and placeholder as a string", () => {
    expect(
      Check(AskUserParamsSchema, {
        questions: [{ ...textQuestion("t"), multi: true, placeholder: "hint" }],
      }),
    ).toBe(true);
    expect(
      Check(AskUserParamsSchema, {
        questions: [{ ...textQuestion("t"), multi: 42 }],
      }),
    ).toBe(false);
    expect(
      Check(AskUserParamsSchema, {
        questions: [{ ...textQuestion("t"), placeholder: 42 }],
      }),
    ).toBe(false);
  });

  it("requires recommendation to be a string array at the schema boundary", () => {
    expect(
      Check(AskUserParamsSchema, {
        questions: [{ ...choiceWith(2), recommendation: ["a"] }],
      }),
    ).toBe(true);
    // A plain string passes the flattened schema only via normalize's coercion.
    expect(
      Check(AskUserParamsSchema, {
        questions: [{ ...choiceWith(2), recommendation: "a" }],
      }),
    ).toBe(false);
    expect(
      Check(AskUserParamsSchema, {
        questions: [{ ...choiceWith(2), recommendation: ["a", 42] }],
      }),
    ).toBe(false);
  });

  it("accepts an option without description or details", () => {
    expect(Check(AskUserParamsSchema, { questions: [choiceWith(2)] })).toBe(true);
  });
});
