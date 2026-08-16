// External, model-facing parameter schema for the redesigned ask_user tool.
//
// Google/Gemini compatibility: the schema is flattened — no Type.Union /
// Type.Literal anywhere. The question-kind discriminator is a plain string
// `enum` (the installed typebox emits a JSON-Schema `enum`, which Google
// supports; Type.Union/Type.Literal emit `anyOf`/`const`, which it does not —
// see extensions.md:2002). `recommendation` is declared as a string array;
// normalize coerces a plain string into `[string]` so the public API keeps
// accepting both shapes.

import { Type } from "typebox";
import { ASK_USER_LIMITS } from "./types.ts";

const OptionSchema = Type.Object({
  value: Type.String({ description: "Unique returned id" }),
  label: Type.String({ description: "Displayed label" }),
  description: Type.Optional(
    Type.String({
      description: "Optional helper text",
    }),
  ),
  details: Type.Optional(
    Type.String({
      description:
        "Extended details shown when focused — trade-offs, code snippets, or consequences",
    }),
  ),
});

const ChoiceOptionCount = {
  minItems: ASK_USER_LIMITS.minChoiceOptions,
  maxItems: ASK_USER_LIMITS.maxChoiceOptions,
} as const;
const QuestionCount = {
  minItems: ASK_USER_LIMITS.minQuestions,
  maxItems: ASK_USER_LIMITS.maxQuestions,
} as const;

const QuestionSchema = Type.Object({
  type: Type.String({
    enum: ["choice", "text"],
    description: "Question kind",
  }),
  id: Type.String({ description: "Unique question id" }),
  header: Type.String({ description: "Short label" }),
  prompt: Type.String({ description: "Question text" }),
  options: Type.Optional(
    Type.Array(OptionSchema, {
      description: "Allowed options with unique values (choice questions)",
      ...ChoiceOptionCount,
    }),
  ),
  multi: Type.Optional(
    Type.Boolean({
      default: false,
      description: "Allow multiple selections (choice questions)",
    }),
  ),
  recommendation: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Recommended option value(s) for choice questions; a plain string is also accepted and normalized to a one-element array",
    }),
  ),
  placeholder: Type.Optional(Type.String({ description: "Editor placeholder (text questions)" })),
});

export const AskUserParamsSchema = Type.Object({
  title: Type.Optional(Type.String({ description: "Optional title" })),
  intro: Type.Optional(
    Type.String({
      description: "Optional context",
    }),
  ),
  questions: Type.Array(QuestionSchema, {
    description: "1-10 related questions for one decision",
    ...QuestionCount,
  }),
});

// The public TS types mirror the flattened schema but keep the ergonomics the
// runtime normalize layer expects: both `type` discriminator values, a
// string-or-array `recommendation`, and required `options` on choice questions
// (normalize validates their presence). They are supersets of the schema's
// Static type, so pi's `execute(toolCallId, params: Static<TParams>, ...)`
// payloads remain assignable.

export interface ExternalOption {
  value: string;
  label: string;
  description?: string;
  details?: string;
}

export interface ExternalQuestion {
  type: string;
  id: string;
  header: string;
  prompt: string;
  options?: ExternalOption[];
  multi?: boolean;
  recommendation?: string | string[];
  placeholder?: string;
}

export interface ExternalChoiceQuestion extends ExternalQuestion {
  type: "choice";
  options: ExternalOption[];
}

export interface ExternalTextQuestion extends ExternalQuestion {
  type: "text";
  recommendation?: string;
}

export interface AskUserParams {
  title?: string;
  intro?: string;
  questions: ExternalQuestion[];
}
