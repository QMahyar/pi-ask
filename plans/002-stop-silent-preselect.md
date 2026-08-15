# Plan 002: Stop silent pre-selection of single-select questions

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. Do NOT update `plans/README.md`; the reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat d8926ca..HEAD -- src test`
> If any file under `src/` or `test/` changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: plans/001-controller-tests.md (must be merged first)
- **Category**: bug
- **Planned at**: commit `d8926ca`, 2026-08-15

## Why this matters

README (the package's spec) says: "Recommendations/prefill — agent suggests, you can change" and "`needs_discussion` when unanswered". But a single-select question with **no** recommendation silently pre-selects option 0 (`defaultToFirst: !multi` in normalize.ts). Because the controller seeds `selected` from `recommendedIndexes` (controller.ts:252), an untouched question reports `answered: true` — so a form the user submits without touching anything returns `submitted` with option 0 chosen, and `needs_discussion` is unreachable for that question unless the user explicitly marks it unanswered. A "recommendation" (suggestion) is being treated as a "default" (selection). This plan makes no-recommendation mean no pre-selection, so unanswered questions honestly report `needs_discussion`. Explicit recommendations still pre-select.

## Current state

- `src/normalize.ts:127-133`:
```ts
recommendedIndexes: resolveIndexes({
  questionId: question.id,
  options,
  value: question.recommendation,
  multi,
  defaultToFirst: !multi,
}),
```
- `src/normalize.ts:221-252` — `resolveIndexes` takes `defaultToFirst: boolean`; when `value === undefined` it returns `defaultToFirst ? [0] : []` (:229-231).
- `src/session/controller.ts:245-261` — `initialState` seeds `selected: question.recommendedIndexes.includes(i)` for choice questions; text questions seed `value: question.recommendation ?? ""` (text has no default-to-first problem — leave it).
- After plan 001 lands, `test/controller.test.ts` group 2 asserts "no recommendation → option 0 selected" and group 12's `needs_discussion` test uses a text question. THIS plan flips the group-2 assertion and adds a single-select needs_discussion case.
- Multi-select already uses `defaultToFirst: false`; its behavior is unchanged by this plan.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `npm install` | exit 0 |
| Tests | `npx vitest run` | all pass |
| Grep | `rg "defaultToFirst" src test` | no matches after Step 2 |

## Scope

**In scope** (the only files you should modify):
- `src/normalize.ts`
- `test/controller.test.ts` (flip/extend assertions)

**Out of scope** (do NOT touch, even though they look related):
- `src/ui/` and `src/session/controller.ts` — the UI/focus logic may reference `recommendedIndexes`; you must NOT change it. If you discover the UI depends on the pre-selection for focus/cursor behavior, that is a STOP condition (see below), not something to fix.
- `test/normalize.test.ts` (verify it still passes; do not edit unless a failure forces a *minimal* correction, which you must report).
- `src/render/`, `src/tool/`, `README.md`.

## Git workflow

- Branch: `advisor/002-no-silent-preselect`
- Commit: `fix: don't pre-select single-select questions without a recommendation`
- Do NOT push or open a PR.

## Steps

### Step 1: Remove `defaultToFirst` from the normalize path

In `src/normalize.ts`:
1. In `normalizeChoice` (:127-133), change the `resolveIndexes` call to drop the `defaultToFirst` property.
2. In `resolveIndexes` (:221-252), remove the `defaultToFirst` field from the args type, the destructure, and the conditional: when `value === undefined` return `[]` unconditionally.

Resulting shape:
```ts
if (value === undefined) return [];
```

**Verify**: `rg "defaultToFirst" src test` → no matches.

### Step 2: Flip the pinned assertions in `test/controller.test.ts`

1. Group 2 ("initial state (choice)"): change "no recommendation → option 0 selected" to "no recommendation → nothing selected" (`isOptionSelected` false for every option).
2. Group 12 ("outcome — needs_discussion"): add a case — questionnaire with a single-select choice (no recommendation) left untouched → `outcome: "needs_discussion"`, that response `answered: false`, `options` empty.

**Verify**: `npx vitest run` → all tests pass (normalize + controller).

### Step 3: Confirm no UI dependency on pre-selection (read-only)

Run `rg "recommendedIndexes" src` and read each hit. The form renders `[recommended]` badges from `recommendedIndexes` — that must keep working (it does: the array is still populated from explicit recommendations). Verify no UI code assumes `recommendedIndexes` is never empty (e.g. default focus logic).

**Verify**: you can state in your report which files reference `recommendedIndexes` and that none assume non-empty.

## Test plan

- Flipped/extended assertions in `test/controller.test.ts` (groups 2, 12) — written by plan 001, updated here.
- No new files.

## Done criteria

All must hold:

- [ ] `rg "defaultToFirst" src test` → no matches
- [ ] `npx vitest run` exits 0
- [ ] Single-select without recommendation: no pre-selection, untouched → `needs_discussion` (asserted)
- [ ] Explicit recommendation still pre-selects (group 2 first case still green)
- [ ] Only `src/normalize.ts` and `test/controller.test.ts` modified

## STOP conditions

Stop and report back (do not improvise) if:

- Any `src/ui/` code references `recommendedIndexes` in a way that assumes a non-empty array (default focus, cursor positioning). Report with file:line — the fix may need a UI change this plan deliberately excludes.
- `test/normalize.test.ts` fails and the only fix touches behavior beyond a minimal assertion correction.
- The codebase drifted from the excerpts above.

## Maintenance notes

- The `[recommended]` badge in the form (form-render.ts:197-199) still shows for explicit recommendations — unchanged.
- Guidance in `src/tool/guidance.ts:15` already tells the model "unanswered questions return `needs_discussion`" — this fix makes the code match the guidance.
- Future work: consider showing recommendations in the form even when nothing is pre-selected (visual affordance) — explicitly out of scope.