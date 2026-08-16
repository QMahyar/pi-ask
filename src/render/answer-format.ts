// Shared answer formatting used by both the transcript renderer
// (formatAnswerLine) and the result renderer (formatAnswerSummaryLine).

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
