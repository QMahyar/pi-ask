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
