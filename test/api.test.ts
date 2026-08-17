import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  AskUserController,
  AskUserParamsSchema,
  AskUserValidationError,
  normalizeQuestionnaire,
} from "../src/api.ts";
import askUserExtension from "../src/extension.ts";

describe("package entry (src/api.ts)", () => {
  it("exposes the schema, normalization, and controller APIs", () => {
    expect(AskUserParamsSchema).toBeDefined();
    expect(normalizeQuestionnaire).toBeTypeOf("function");
    expect(AskUserController).toBeTypeOf("function");
    expect(AskUserValidationError).toBeTypeOf("function");
  });

  it("re-exports the extension as the default from the extension entry", () => {
    expect(askUserExtension).toBeTypeOf("function");
  });

  it("validates a payload through the re-exported schema", () => {
    expect(
      Check(AskUserParamsSchema, {
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
          },
        ],
      }),
    ).toBe(true);
    expect(Check(AskUserParamsSchema, { questions: [] })).toBe(false);
  });

  it("normalizes through the re-exported entry and preserves error identity", () => {
    const q = normalizeQuestionnaire({
      questions: [{ type: "text", id: "t", header: "H", prompt: "P?" }],
    });
    expect(q.questions).toHaveLength(1);
    try {
      normalizeQuestionnaire({ questions: [] });
    } catch (error) {
      expect(error).toBeInstanceOf(AskUserValidationError);
    }
  });

  it("constructs a controller through the re-exported entry", () => {
    const controller = new AskUserController({
      questions: [{ type: "text", id: "t", header: "H", prompt: "P?" }],
    });
    expect(controller.currentIndex).toBe(0);
    expect(controller.currentQuestion.id).toBe("t");
  });
});
