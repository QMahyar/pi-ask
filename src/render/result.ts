import {
  type AgentToolResult,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import type {
  AskUserDetails,
  AskUserOutcome,
  AskUserResponse,
  AskUserToolDetails,
  ChoiceQuestionResponse,
  NormalizedQuestion,
  NormalizedQuestionnaire,
} from "../types.ts";
import { formatSelectedOptions } from "./answer-format.ts";

export type AskUserToolResult = AgentToolResult<AskUserToolDetails>;

export function buildResult(
  questionnaire: NormalizedQuestionnaire,
  outcome: AskUserOutcome,
): AskUserToolResult {
  const details: AskUserDetails = {
    ...(questionnaire.title ? { title: questionnaire.title } : {}),
    ...(questionnaire.intro ? { intro: questionnaire.intro } : {}),
    questions: questionnaire.questions,
    outcome: outcome.outcome,
    comment: outcome.comment,
    responses: outcome.responses,
  };

  return {
    content: [
      {
        type: "text",
        text: truncateModelVisibleSummary(summarizeOutcome(questionnaire.questions, outcome)),
      },
    ],
    details,
  };
}

function truncateModelVisibleSummary(summary: string): string {
  const truncation = truncateHead(summary, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  if (!truncation.truncated) return summary;

  const notice = truncation.firstLineExceedsLimit
    ? `[Output truncated: first response line exceeds ${formatSize(truncation.maxBytes)}; ask a focused follow-up for omitted text.]`
    : `[Output truncated: showing ${truncation.outputLines}/${truncation.totalLines} lines (${formatSize(truncation.outputBytes)}/${formatSize(truncation.totalBytes)}); ask a focused follow-up for omitted text.]`;

  return truncation.content ? `${truncation.content}\n\n${notice}` : notice;
}

function summarizeOutcome(questions: NormalizedQuestion[], outcome: AskUserOutcome): string {
  const responseLines = outcome.responses.flatMap((response) =>
    formatResponseSummaryLines(questions, response),
  );

  const headerLines =
    outcome.outcome === "submitted"
      ? []
      : [
          "User needs discussion before a complete decision.",
          ...formatUnansweredSummary(questions, outcome.responses),
        ];

  const commentLines = outcome.comment ? [`Form comment: ${outcome.comment}`] : [];
  const lines = [...headerLines, ...commentLines, ...responseLines];

  if (lines.length > 0) return lines.join("\n");
  return outcome.outcome === "submitted"
    ? "User submitted the form."
    : "User needs discussion before a complete decision.";
}

function formatUnansweredSummary(
  questions: NormalizedQuestion[],
  responses: AskUserResponse[],
): string[] {
  const unanswered = responses
    .filter((response) => !response.answer.answered)
    .map((response) => {
      const question = questions.find((q) => q.id === response.questionId);
      if (!question) return response.questionId;
      // Identify unanswered questions by their stable id, with the human
      // header alongside for context (headers are unique per form).
      return question.id ? `${question.id}: ${question.header}` : question.header;
    });

  return unanswered.length > 0 ? [`Unanswered: ${unanswered.join(", ")}`] : [];
}

function formatResponseSummaryLines(
  questions: NormalizedQuestion[],
  response: AskUserResponse,
): string[] {
  const header = questionHeader(questions, response.questionId);
  const answerLine = formatAnswerSummaryLine(header, response);
  const lines = answerLine ? [answerLine] : [];

  if (response.questionComment) {
    lines.push(`${header} question comment: ${response.questionComment}`);
  }

  if (response.answer.kind === "choice") {
    lines.push(...formatUnselectedOptionCommentLines(header, response as ChoiceQuestionResponse));
  }

  return lines;
}

function formatAnswerSummaryLine(header: string, response: AskUserResponse): string | undefined {
  if (!response.answer.answered) return undefined;

  if (response.answer.kind === "choice") {
    const selected = formatSelectedOptions(response.answer.options);
    return selected ? `${header}: ${selected}` : undefined;
  }

  if (response.answer.kind === "text" && response.answer.value) {
    return `${header}: ${response.answer.value}`;
  }

  return undefined;
}

function formatUnselectedOptionCommentLines(
  header: string,
  response: ChoiceQuestionResponse,
): string[] {
  return response.answer.options.flatMap((option) => {
    if (option.selected || !option.comment) return [];
    return [`${header} option comment (${option.label}): ${option.comment}`];
  });
}

function questionHeader(questions: NormalizedQuestion[], questionId: string): string {
  return questions.find((question) => question.id === questionId)?.header ?? questionId;
}
