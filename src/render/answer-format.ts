// Shared answer formatting used by both the transcript renderer and the
// result renderer, plus the pure selection-marker glyph primitive.

import type { AskUserResponse } from "../types.ts";

export type SelectedOptionLike = {
  label: string;
  selected: boolean;
  comment?: string;
};

/** Formats the selected options of a choice answer as a "; "-joined string, or undefined when none are selected. */
export function formatSelectedOptions(options: readonly SelectedOptionLike[]): string | undefined {
  const selected = options.filter((option) => option.selected);
  if (selected.length === 0) return undefined;
  return selected
    .map((option) =>
      option.comment ? `${option.label} (comment: ${option.comment})` : option.label,
    )
    .join("; ");
}

/**
 * Formats one answer's value: selected option labels for choice, the raw text
 * for text questions. Returns undefined when the question was not answered
 * (or a choice answer carries no selection).
 */
export function formatAnswerValue(response: AskUserResponse): string | undefined {
  if (!response.answer.answered) return undefined;

  if (response.answer.kind === "choice") {
    return formatSelectedOptions(response.answer.options);
  }

  if (response.answer.kind === "text" && response.answer.value) {
    return response.answer.value;
  }

  return undefined;
}

/** Selection marker glyphs: single-select uses parentheses, multi-select uses brackets. */
export function choiceMarker(multi: boolean, selected: boolean): string {
  if (multi) return selected ? "[x]" : "[ ]";
  return selected ? "(*)" : "( )";
}
