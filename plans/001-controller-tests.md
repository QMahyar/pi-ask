# Plan 001: Add AskUserController tests

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. Do NOT update `plans/README.md`; the reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat d8926ca..HEAD -- src test`
> If any file under `src/` or `test/` changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `d8926ca`, 2026-08-15

## Why this matters

`AskUserController` (src/session/controller.ts) is the heart of the package — it holds answer state, decides `submitted` vs `needs_discussion`, handles comments, cancel/abort, and unanswered-marking. It has **zero tests**. `executeAskUser` in src/ask-user.ts:107 is explicitly exported "for tests" but nothing tests it. Only normalize (test/normalize.test.ts, 4 tests) is covered. Plan 002 changes controller-adjacent behavior and needs these tests as its safety net.

## Current state

- `src/session/controller.ts` — 314-line state machine. Key behaviors (verified at these lines):
  - `initialState` (:245-261): choice questions seed `selected` from `question.recommendedIndexes`; text questions seed `value` from `question.recommendation ?? ""`.
  - `selectChoiceOption` (:140-149): single-select exclusivity via reference comparison; clears `markedUnanswered`.
  - `toggleChoiceOption` (:153-167): multi toggles; non-multi delegates to `selectChoiceOption`.
  - `setTextAnswer` (:171-177): trims; clears `markedUnanswered` when non-empty.
  - `markCurrentQuestionUnanswered` (:186-198): clears selection/value of the **current** question (uses `this.index`), sets `markedUnanswered`, preserves comments.
  - `outcome()` (:223-233): `submitted` iff every response `answered`; includes form comment when set.
  - `buildChoiceResponse` (:275-296): only touched options (selected or commented) appear; `answered` = any selected.
  - `buildTextResponse` (:298-313): `answered` = non-empty value; value omitted when unanswered.
  - `cancel()`/`abort()` (:202-214): idempotent; set `terminal`, store `terminalResult`, block all mutations.
  - Comments (:98-136): all trim; empty → undefined; `setChoiceOptionComment` guards terminal + index bounds.
  - Navigation (:63-82): `goNext`/`goBack`/`goTo` bounds-checked; all no-op when terminal.
  - `stateFor` (:237-243): throws `Unknown question id "..."` for unknown ids.
  - Constructor (:42-47): throws when `questions.length === 0`.
- Repo test conventions (match exactly): vitest; explicit imports `import { describe, expect, it } from "vitest";`; plain TS, no setup file; test files live in `test/`; pattern file: `test/normalize.test.ts` (97 lines).
- No tsconfig exists; vitest runs TS directly. Run tests with `npx vitest run`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `npm install` | exit 0 |
| Tests (all) | `npx vitest run` | all tests pass |
| Tests (filtered) | `npx vitest run test/controller.test.ts` | new tests pass |

## Scope

**In scope** (the only files you should modify):
- `test/controller.test.ts` (create)

**Out of scope** (do NOT touch, even though they look related):
- `src/session/controller.ts` and all other `src/` files — behavior is pinned here, not changed (plan 002 changes it later).
- `test/normalize.test.ts`
- Any `plans/` file, `package.json`, lockfile.

## Git workflow

- Branch: `advisor/001-controller-tests`
- Commit once at the end: `test: add AskUserController coverage` (repo history uses plain descriptive subjects; single commit is fine).
- Do NOT push or open a PR.

## Steps

### Step 1: Create `test/controller.test.ts`

Model the structure on `test/normalize.test.ts` (describe/it blocks, `expect` assertions). Import `AskUserController` from `../src/session/controller.ts`.

Write the following test groups. Use small inline questionnaires (2 questions max per fixture: one choice, one text, ids `c1`/`t1`). IMPORTANT — pin **current** behavior exactly; in particular a single-select choice question with NO recommendation currently pre-selects option 0 (that is deliberate here: plan 002 changes it, and its test assertion will flip then).

1. **constructor**: throws on empty `questions: []`.
2. **initial state (choice)**: with `recommendation: "b"` → only that index selected. With no recommendation → **option 0 selected** (current behavior — assert `isOptionSelected("c1", <option0value>) === true`). Multi with `recommendation: ["a","c"]` → those selected.
3. **initial state (text)**: with `recommendation: "suggested"` → `getTextAnswer` returns it; without → `""`.
4. **selectChoiceOption**: single-select exclusivity (select option 1 then option 2 → only 2 selected); clears `markedUnanswered` (set via `markCurrentQuestionUnanswered` first, then select → `isQuestionMarkedUnanswered` false).
5. **toggleChoiceOption**: multi — toggles twice returns to original; non-multi — behaves like select.
6. **setTextAnswer**: trims whitespace; clears `markedUnanswered` when non-empty; keeps `markedUnanswered` when empty.
7. **markCurrentQuestionUnanswered**: on a choice question clears all selections and sets `markedUnanswered`; on a text question clears value; preserves question and option comments (set a comment first, mark unanswered, assert comment still returned).
8. **comments**: `setComment("  hi  ")` → `"hi"`; `setComment("   ")` → `undefined`. Same trimming for `setQuestionComment`/`getQuestionComment` and `setChoiceOptionComment`/`getOptionComment`. `setChoiceOptionComment` with a bad index is a no-op.
9. **navigation**: `goNext`/`goBack`/`goTo` bounds (0, last, out-of-range returns false / no-op); after `cancel()`, all navigation and mutation methods are no-ops.
10. **cancel/abort**: `cancel()` twice returns `{kind:"cancel"}` both times and `getInteractionResult()` is `{kind:"cancel"}`; `abort()` similarly.
11. **outcome — submitted**: two questions, both answered (select an option; type text) → `outcome: "submitted"`.
12. **outcome — needs_discussion**: text question untouched → `outcome: "needs_discussion"` and that response `answered: false`.
13. **outcome — commented-but-unselected option**: a choice option with a comment but not selected → appears in `response.answer.options` with `selected: false`; question still `answered: false`.
14. **outcome — form comment**: `setComment("thanks")` → included as `comment`; absent when unset.
15. **outcome — text value shape**: answered text includes `value`; unanswered omits it.
16. **stateFor**: `getTextAnswer("nope")` throws `Unknown question id`.

**Verify**: `npx vitest run test/controller.test.ts` → all pass, roughly 25-35 assertions. Then `npx vitest run` → the full suite (normalize + controller) passes.

## Test plan

The tests above ARE this plan's deliverable. Existing pattern: `test/normalize.test.ts`. No new test infrastructure.

## Done criteria

All must hold:

- [ ] `npx vitest run` exits 0 (normalize tests + new controller tests)
- [ ] `test/controller.test.ts` exists and covers all 16 groups above
- [ ] No files outside `test/controller.test.ts` modified (`git status` shows only it)
- [ ] No changes to any `src/` file

## STOP conditions

Stop and report back (do not improvise) if:

- Any file under `src/` no longer matches the "Current state" excerpts (drift).
- A behavior you need to pin doesn't exist in the code (e.g. a method renamed).
- A test reveals behavior contradicting the excerpts above (report it — do not "fix" the source).

## Maintenance notes

- Plan 002 flips the "no recommendation → option 0 selected" assertion (groups 2 and 12). Do not preempt it.
- When the TUI adds question types, the controller needs new state kinds — tests here will show exactly what's pinned.