// Shared internal and public data model for the redesigned ask_user tool.
// The external tool-call schema lives in schema.ts; everything past validation
// works with the normalized shapes defined here.

export interface NormalizedOption {
  value: string;
  label: string;
  description?: string;
  details?: string;
}

interface BaseQuestion {
  id: string;
  header: string;
  prompt: string;
}

export interface NormalizedChoiceQuestion extends BaseQuestion {
  type: "choice";
  options: NormalizedOption[];
  multi: boolean;
  recommendedIndexes: number[];
}

export interface NormalizedTextQuestion extends BaseQuestion {
  type: "text";
  recommendation?: string;
  placeholder?: string;
}

export type NormalizedQuestion = NormalizedChoiceQuestion | NormalizedTextQuestion;

export interface NormalizedQuestionnaire {
  title?: string;
  intro?: string;
  questions: NormalizedQuestion[];
}

// ── User-facing outcome types ──────────────────────────────────────

export type AskUserOutcomeKind = "submitted" | "needs_discussion";

export interface ChoiceQuestionResponse {
  questionId: string;
  questionComment?: string;
  answer: {
    kind: "choice";
    answered: boolean;
    options: Array<{
      value: string;
      label: string;
      selected: boolean;
      comment?: string;
    }>;
  };
}

export interface TextQuestionResponse {
  questionId: string;
  questionComment?: string;
  answer: {
    kind: "text";
    answered: boolean;
    value?: string;
  };
}

export type AskUserResponse = ChoiceQuestionResponse | TextQuestionResponse;

export interface AskUserOutcome {
  outcome: AskUserOutcomeKind;
  comment?: string;
  responses: AskUserResponse[];
}

export interface AskUserDetails extends AskUserOutcome {
  title?: string;
  intro?: string;
  questions: NormalizedQuestion[];
}

// The tool details are always user-facing AskUserDetails; failures are reported
// via context.isError + result.content by pi, and the transcript renderer keys
// off context.isError instead of a details-level error variant.
export type AskUserToolDetails = AskUserDetails;

// ── Internal interaction result: UI cancel/abort are NOT persisted ──
export type AskUserInteractionResult = AskUserInteractionCancel | AskUserInteractionAbort;

export interface AskUserInteractionCancel {
  kind: "cancel";
}

export interface AskUserInteractionAbort {
  kind: "abort";
}

/** Narrowing guard for internal interaction results, shared by the UI result relay and the ask-user executor. */
export function isAskUserInteractionResult(value: unknown): value is AskUserInteractionResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    (value.kind === "cancel" || value.kind === "abort")
  );
}

// ── Limits ─────────────────────────────────────────────────────────

export const ASK_USER_LIMITS = {
  minQuestions: 1,
  maxQuestions: 10,
  minChoiceOptions: 2,
  maxChoiceOptions: 12,
  maxHeaderLength: 60,
  maxPromptLength: 4000,
  maxTitleLength: 120,
  maxIntroLength: 4000,
  maxPlaceholderLength: 200,
  maxQuestionIdLength: 100,
  maxOptionLabelLength: 200,
  maxOptionDescriptionLength: 1000,
  maxOptionDetailsLength: 2000,
  maxOptionValueLength: 200,
  maxRecommendationLength: 200,
} as const;
