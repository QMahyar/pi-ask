// Validation and normalization for ask_user tool calls.

import type {
  AskUserParams,
  ExternalChoiceQuestion,
  ExternalOption,
  ExternalQuestion,
  ExternalTextQuestion,
} from "./schema.ts";
import {
  ASK_USER_LIMITS,
  type NormalizedChoiceQuestion,
  type NormalizedOption,
  type NormalizedQuestion,
  type NormalizedQuestionnaire,
  type NormalizedTextQuestion,
} from "./types.ts";

const DEPRECATED_TOP_LEVEL_KEYS = ["allowPartialSubmit"] as const;
const DEPRECATED_CHOICE_KEYS = ["required", "initial", "allowOther"] as const;
const DEPRECATED_TEXT_KEYS = ["required", "initial"] as const;

const OUTPUT_ONLY_KEYS = ["needs_discussion", "outcome", "responses"] as const;

const DEPRECATED_CHOICE_REPLACEMENTS: Record<(typeof DEPRECATED_CHOICE_KEYS)[number], string> = {
  required:
    'All questions are always required for a full submission; unanswered questions produce the "needs_discussion" outcome.',
  initial: 'Use "recommendation" for suggested options.',
  allowOther: "Use a separate text question for free-form input.",
};

const DEPRECATED_TEXT_REPLACEMENTS: Record<(typeof DEPRECATED_TEXT_KEYS)[number], string> = {
  required:
    'All questions are always required for a full submission; unanswered questions produce the "needs_discussion" outcome.',
  initial: 'Use "recommendation" for suggested text.',
};

export class AskUserValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AskUserValidationError";
  }
}

export function normalizeQuestionnaire(params: AskUserParams): NormalizedQuestionnaire {
  if (typeof params !== "object" || params === null) {
    throw new AskUserValidationError('ask_user params must be an object with a "questions" array.');
  }

  // Reject hallucinated output fields: the tool returns these; the model must
  // never pass them.
  for (const key of OUTPUT_ONLY_KEYS) {
    if (key in params) {
      throw new AskUserValidationError(
        key === "needs_discussion"
          ? "`needs_discussion` is an output field; the tool returns it when questions are unanswered — do not pass it."
          : `"${key}" is an output field returned by the tool; do not pass it as input.`,
      );
    }
  }

  // Reject deprecated top-level fields
  for (const key of DEPRECATED_TOP_LEVEL_KEYS) {
    if (key in params) {
      throw new AskUserValidationError(
        `The "${key}" field is no longer supported. All questions are always required for a full submission. Use "needs_discussion" outcome for unanswered questions.`,
      );
    }
  }

  if (!Array.isArray(params.questions)) {
    throw new AskUserValidationError('"questions" must be an array of 1-10 questions.');
  }

  validateQuestionCount(params.questions.length);
  const title = trimOptional(params.title);
  const intro = trimOptional(params.intro);
  if (title && title.length > ASK_USER_LIMITS.maxTitleLength) {
    throw new AskUserValidationError(`title exceeds ${ASK_USER_LIMITS.maxTitleLength} characters.`);
  }
  if (intro && intro.length > ASK_USER_LIMITS.maxIntroLength) {
    throw new AskUserValidationError(`intro exceeds ${ASK_USER_LIMITS.maxIntroLength} characters.`);
  }

  const seen = new Set<string>();
  const seenHeaders = new Set<string>();
  const questions = params.questions.map((question) => {
    const normalized = normalizeQuestion(question);
    if (seen.has(normalized.id)) {
      throw new AskUserValidationError(
        `Duplicate question id "${normalized.id}" — ids must be unique within one form.`,
      );
    }
    seen.add(normalized.id);
    if (seenHeaders.has(normalized.header)) {
      throw new AskUserValidationError(
        `Duplicate question header "${normalized.header}" — headers must be unique within one form.`,
      );
    }
    seenHeaders.add(normalized.header);
    return normalized;
  });

  return {
    ...(title ? { title } : {}),
    ...(intro ? { intro } : {}),
    questions,
  };
}

function normalizeQuestion(question: ExternalQuestion): NormalizedQuestion {
  if (typeof question !== "object" || question === null) {
    throw new AskUserValidationError(
      "Each question must be an object with a type, id, header, and prompt.",
    );
  }
  validateCommonFields(question);
  // The flattened schema keeps the kind as a plain string enum; the runtime
  // check below discriminates, and the cast narrows for the kind-specific
  // validators (which re-check every field they require).
  return question.type === "choice"
    ? normalizeChoice(question as ExternalChoiceQuestion)
    : normalizeText(question as ExternalTextQuestion);
}

function validateQuestionCount(count: number): void {
  if (count < ASK_USER_LIMITS.minQuestions || count > ASK_USER_LIMITS.maxQuestions) {
    throw new AskUserValidationError(
      `ask_user supports ${ASK_USER_LIMITS.minQuestions}-${ASK_USER_LIMITS.maxQuestions} questions only (got ${count}).`,
    );
  }
}

function validateCommonFields(question: ExternalQuestion): void {
  if (typeof question.id !== "string") {
    throw new AskUserValidationError("Question id must be a non-empty string.");
  }
  const id = question.id.trim();
  if (!id) throw new AskUserValidationError("Question id must be a non-empty string.");
  if (id.length > ASK_USER_LIMITS.maxQuestionIdLength) {
    throw new AskUserValidationError(
      `Question id "${id}" exceeds ${ASK_USER_LIMITS.maxQuestionIdLength} characters.`,
    );
  }
  if (typeof question.header !== "string" || typeof question.prompt !== "string") {
    throw new AskUserValidationError(
      `Question "${id}" must include non-empty header and prompt strings.`,
    );
  }
  const header = normalizeDisplayText(question.header);
  const prompt = normalizeDisplayText(question.prompt);

  if (!header) {
    throw new AskUserValidationError(`Question "${id}" must include a non-empty header.`);
  }
  if (header.length > ASK_USER_LIMITS.maxHeaderLength) {
    throw new AskUserValidationError(
      `Question "${id}" header exceeds ${ASK_USER_LIMITS.maxHeaderLength} characters.`,
    );
  }
  if (!prompt) {
    throw new AskUserValidationError(`Question "${id}" must include a non-empty prompt.`);
  }
  if (prompt.length > ASK_USER_LIMITS.maxPromptLength) {
    throw new AskUserValidationError(
      `Question "${id}" prompt exceeds ${ASK_USER_LIMITS.maxPromptLength} characters.`,
    );
  }
}

function normalizeChoice(question: ExternalChoiceQuestion): NormalizedChoiceQuestion {
  // Reject deprecated fields on choice questions, with per-field replacements
  for (const key of DEPRECATED_CHOICE_KEYS) {
    if (key in question) {
      throw new AskUserValidationError(
        `The "${key}" field on choice questions is no longer supported. ${DEPRECATED_CHOICE_REPLACEMENTS[key]}`,
      );
    }
  }

  const options = normalizeOptions(question.id.trim(), question.options);
  const multi = question.multi ?? false;

  validateRecommendationShape(question.id, question.recommendation, multi);

  return {
    id: question.id.trim(),
    header: normalizeDisplayText(question.header),
    prompt: normalizeDisplayText(question.prompt),
    type: "choice",
    options,
    multi,
    recommendedIndexes: resolveIndexes({
      questionId: question.id,
      options,
      value: question.recommendation,
    }),
  };
}

function normalizeText(question: ExternalTextQuestion): NormalizedTextQuestion {
  // Reject deprecated fields on text questions, with per-field replacements
  for (const key of DEPRECATED_TEXT_KEYS) {
    if (key in question) {
      throw new AskUserValidationError(
        `The "${key}" field on text questions is no longer supported. ${DEPRECATED_TEXT_REPLACEMENTS[key]}`,
      );
    }
  }

  if (question.options !== undefined || question.multi !== undefined) {
    throw new AskUserValidationError(
      `text question "${question.id}" cannot have options or multi — they are only valid on choice questions.`,
    );
  }

  if (Array.isArray(question.recommendation)) {
    throw new AskUserValidationError(
      `text question "${question.id}" recommendation must be a string, not an array.`,
    );
  }

  const placeholder = trimOptional(question.placeholder);
  if (placeholder && placeholder.length > ASK_USER_LIMITS.maxPlaceholderLength) {
    throw new AskUserValidationError(
      `Question "${question.id}" placeholder exceeds ${ASK_USER_LIMITS.maxPlaceholderLength} characters.`,
    );
  }

  const recommendation = trimOptional(question.recommendation);
  if (recommendation && recommendation.length > ASK_USER_LIMITS.maxRecommendationLength) {
    throw new AskUserValidationError(
      `Question "${question.id}" recommendation exceeds ${ASK_USER_LIMITS.maxRecommendationLength} characters.`,
    );
  }

  return {
    id: question.id.trim(),
    header: normalizeDisplayText(question.header),
    prompt: normalizeDisplayText(question.prompt),
    type: "text",
    ...(recommendation ? { recommendation } : {}),
    ...(placeholder ? { placeholder } : {}),
  };
}

function normalizeOptions(
  questionId: string,
  options: ExternalOption[] | undefined,
): NormalizedOption[] {
  const count = options?.length ?? 0;
  if (count < ASK_USER_LIMITS.minChoiceOptions || count > ASK_USER_LIMITS.maxChoiceOptions) {
    throw new AskUserValidationError(
      `choice question "${questionId}" must have ${ASK_USER_LIMITS.minChoiceOptions}-${ASK_USER_LIMITS.maxChoiceOptions} options (got ${count}).`,
    );
  }

  const seen = new Set<string>();
  return (options ?? []).map((option) => {
    const value = option.value.trim();
    const label = normalizeDisplayText(option.label);
    if (!value || !label) {
      throw new AskUserValidationError(
        `choice question "${questionId}" has an option with empty value or label.`,
      );
    }
    if (value.length > ASK_USER_LIMITS.maxOptionValueLength) {
      throw new AskUserValidationError(
        `choice question "${questionId}" option value "${value}" exceeds ${ASK_USER_LIMITS.maxOptionValueLength} characters.`,
      );
    }
    if (label.length > ASK_USER_LIMITS.maxOptionLabelLength) {
      throw new AskUserValidationError(
        `choice question "${questionId}" option "${value}" label exceeds ${ASK_USER_LIMITS.maxOptionLabelLength} characters.`,
      );
    }
    if (seen.has(value)) {
      throw new AskUserValidationError(
        `choice question "${questionId}" has duplicate option value "${value}".`,
      );
    }
    seen.add(value);

    const description = trimOptional(option.description);
    if (description && description.length > ASK_USER_LIMITS.maxOptionDescriptionLength) {
      throw new AskUserValidationError(
        `choice question "${questionId}" option "${value}" description exceeds ${ASK_USER_LIMITS.maxOptionDescriptionLength} characters.`,
      );
    }
    const details = trimOptional(option.details);
    if (details && details.length > ASK_USER_LIMITS.maxOptionDetailsLength) {
      throw new AskUserValidationError(
        `choice question "${questionId}" option "${value}" details exceeds ${ASK_USER_LIMITS.maxOptionDetailsLength} characters.`,
      );
    }

    return {
      value,
      label,
      ...(description ? { description } : {}),
      ...(details ? { details } : {}),
    };
  });
}

function validateRecommendationShape(
  questionId: string,
  value: string | string[] | undefined,
  multi: boolean,
): void {
  if (value === undefined) return;
  // The schema declares recommendation as a string array; a plain string is
  // accepted and coerced in resolveIndexes. Only a string on a multi-select
  // question is a genuine shape error.
  if (multi && typeof value === "string") {
    throw new AskUserValidationError(
      `multi-select question "${questionId}" recommendation must be an array, not a string.`,
    );
  }
}

function resolveIndexes(args: {
  questionId: string;
  options: NormalizedOption[];
  value: string | string[] | undefined;
}): number[] {
  const { questionId, options, value } = args;
  if (value === undefined) return [];

  const values: unknown[] = Array.isArray(value) ? value : [value];
  const seen = new Set<string>();
  return values.map((entry) => {
    if (typeof entry !== "string") {
      throw new AskUserValidationError(
        `choice question "${questionId}" recommendation entries must be strings (got ${typeof entry}).`,
      );
    }
    const trimmed = entry.trim();
    if (trimmed.length > ASK_USER_LIMITS.maxRecommendationLength) {
      throw new AskUserValidationError(
        `choice question "${questionId}" recommendation value "${trimmed}" exceeds ${ASK_USER_LIMITS.maxRecommendationLength} characters.`,
      );
    }
    if (seen.has(trimmed)) {
      throw new AskUserValidationError(
        `choice question "${questionId}" has duplicate recommendation value "${trimmed}".`,
      );
    }
    seen.add(trimmed);
    const index = options.findIndex((option) => option.value === trimmed);
    if (index < 0) {
      const allowed = options.map((option) => `"${option.value}"`).join(", ");
      throw new AskUserValidationError(
        `choice question "${questionId}" recommendation value "${trimmed}" does not match any option value. Allowed values: [${allowed}].`,
      );
    }
    return index;
  });
}

/**
 * Decodes JSON-style Unicode escapes that models sometimes emit literally in
 * display text, then strips control characters (C0 and C1) and bidi controls
 * before trimming.
 */
export function normalizeDisplayText(value: string): string {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_escape, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(
      // biome-ignore lint/suspicious/noControlCharactersInRegex: deliberate control + bidi stripping
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F\u202A-\u202E\u2066-\u2069]/g,
      "",
    )
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD")
    .trim();
}

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value === undefined ? undefined : normalizeDisplayText(value);
  return trimmed ? trimmed : undefined;
}
