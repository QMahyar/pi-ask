# Plan 007: Unify selection markers across renderers

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. Do NOT update `plans/README.md`; the reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat d8926ca..HEAD -- src test`
> If any file under `src/` or `test/` changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `d8926ca`, 2026-08-15

## Why this matters

The single-select marker is rendered three ways that disagree with each other: the live form shows `(*)`/`( )` (src/ui/form-render.ts:219-222), the review screen always shows `[x]`/`[ ]` (src/ui/form-review-render.ts:138) even for single-select questions, and the transcript shows the correct `(*)`/`( )` for single-select (src/render/transcript.ts:174). A user who selects "option B" sees `(*) B` in the form, `[x] B` in review — same meaning, different glyphs, and the review screen cannot distinguish single from multi. This plan extracts one canonical `choiceMarker` helper and uses it in all three renderers.

## Current state

- `src/ui/form-render.ts:219-222` (the canonical shape — single-select `(*)`/`( )`, multi `[x]`/`[ ]`):
```ts
function choiceMarker(multi: boolean, selected: boolean): string {
  if (multi) return selected ? "[x]" : "[ ]";
  return selected ? "(*)" : "( )";
}
```
- `src/ui/form-review-render.ts:137-141` (always checkbox — wrong for single-select):
```ts
for (const option of response.answer.options) {
  const marker = option.selected ? theme.fg("success", "[x]") : theme.fg("dim", "[ ]");
  const comment = option.comment ? theme.fg("dim", ` — ${option.comment}`) : "";
  lines.push(`${marker} ${option.label}${comment}`);
}
```
The enclosing function is `renderReviewResponseLines(theme, response, width)` (:112-116) — it has NO access to the question's `multi` flag. It is called from `renderReviewQuestionCard` (:41-83), which renders one question's card and does have the question (verify by reading :41-83 — the `question` parameter is available there).
- `src/render/transcript.ts:170-178` (already correct, but duplicates the shape):
```ts
const multi = question.type === "choice" && question.multi;
const optionLines = resp.answer.options.map((opt) => {
  const selected = opt.selected
    ? theme.fg("success", multi ? "[x]" : "(*)")
    : theme.fg("dim", multi ? "[ ]" : "( )");
  ...
```
- `src/ui/form-render-primitives.ts` — shared render helpers module (renderMiniBox, pushWrappedWithPrefix, wrapLines, safeWidth...). Imported by form-render.ts, form-review-render.ts, and others. This is the home for the shared helper.
- No render tests exist; verification is typecheck/lint + grep.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `npm install` | exit 0 |
| Tests | `npx vitest run` | all pass |
| Grep | `rg "choiceMarker" src` | exactly 4 matches after Step 3 (1 definition + 3 uses) |

## Scope

**In scope** (the only files you should modify):
- `src/ui/form-render-primitives.ts` (add the shared `choiceMarker` export)
- `src/ui/form-render.ts` (delete the local `choiceMarker`, import the shared one)
- `src/ui/form-review-render.ts` (use shared `choiceMarker`; thread `multi` through)
- `src/render/transcript.ts` (use shared `choiceMarker`)

**Out of scope** (do NOT touch, even though they look related):
- `src/render/result.ts`, `src/session/controller.ts`, `test/`, `plans/`, `README.md`.
- Any behavior change to the multi-select markers — they stay `[x]`/`[ ]` everywhere.

## Git workflow

- Branch: `advisor/007-unify-markers`
- Commit: `refactor: unify selection markers across renderers`
- Do NOT push or open a PR.

## Steps

### Step 1: Add the shared helper

In `src/ui/form-render-primitives.ts`, add (exported, near the other helpers — it must be visible to `src/render/transcript.ts` too, so confirm nothing in that module chain breaks the import; the module currently imports from `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` only):
```ts
/** Selection marker glyphs: single-select uses parentheses, multi-select uses brackets. */
export function choiceMarker(multi: boolean, selected: boolean): string {
  if (multi) return selected ? "[x]" : "[ ]";
  return selected ? "(*)" : "( )";
}
```

**Verify**: `npx vitest run` still passes (module loads fine).

### Step 2: Update `src/ui/form-render.ts`

Delete the local `choiceMarker` (:219-222) and import the shared one from `./form-render-primitives.ts` (add to the existing import from that module if present, otherwise add an import line).

**Verify**: `rg "choiceMarker" src/ui/form-render.ts` → 1 match (the use at :196), no definition.

### Step 3: Update `src/render/transcript.ts`

Replace the inline ternary at :174 with `choiceMarker(multi, opt.selected)`:
```ts
const selected = opt.selected
  ? theme.fg("success", choiceMarker(multi, true))
  : theme.fg("dim", choiceMarker(multi, false));
```
Import `choiceMarker` from `../ui/form-render-primitives.ts`.

**Verify**: `rg "choiceMarker" src` → definition + 3 uses (form-render.ts, transcript.ts, form-review-render.ts — once you finish Step 4).

### Step 4: Update `src/ui/form-review-render.ts`

1. Read `renderReviewQuestionCard` (:41-83) to find how `renderReviewResponseLines` is invoked and confirm the question (with its `multi` flag) is in scope at the call site.
2. Thread the flag: change `renderReviewResponseLines` to accept a `multi: boolean` parameter (or the question object — pick whichever is cleaner given the caller), and replace the hardcoded `[x]`/`[ ]` at :138 with `choiceMarker(multi, option.selected)`.
3. Import `choiceMarker` from `./form-render-primitives.ts`.

**Verify**: `rg "choiceMarker" src` → exactly 4 matches (1 definition in form-render-primitives.ts + 3 uses). `rg "\[x\]|\[ \]" src/ui/form-review-render.ts` → no matches (except possibly in comments).

### Step 5: Gates

**Verify**: `npx vitest run` passes; if plan 004 has landed, `npm run typecheck` and `npm run lint` exit 0.

## Test plan

- No new tests (no render test harness exists). Regression risk is covered by typecheck + the grep checks + visual review by the maintainer.

## Done criteria

All must hold:

- [ ] `rg "choiceMarker" src` → exactly 4 matches
- [ ] `rg "\[x\]|\[ \]" src` → only inside `form-render-primitives.ts` (the single source of truth)
- [ ] `npx vitest run` passes
- [ ] Only the four in-scope files modified

## STOP conditions

Stop and report back (do not improvise) if:

- `renderReviewQuestionCard` does not have the question/multi flag in scope at the call site (report the actual structure — the threading may need a different approach).
- `choiceMarker` conflicts with an existing export.
- Any rendered output path (e.g. collapsed transcript) is discovered to depend on the `[x]` literal outside the four files (report with file:line).

## Maintenance notes

- The form (form-render.ts:196-199) also renders `[recommended]` badges — unaffected.
- If the design ever switches glyphs (e.g. `◉`/`○`), one function changes, all renderers follow.
- plan 005 removes dead exports — it does not touch `form-render-primitives.ts`.