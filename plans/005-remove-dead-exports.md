# Plan 005: Remove dead exports

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. Do NOT update `plans/README.md`; the reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat d8926ca..HEAD -- src test`
> If any file under `src/` or `test/` changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `d8926ca`, 2026-08-15

## Why this matters

Three exported symbols have zero consumers, and `src/ask-user.ts` re-exports symbols that `src/api.ts` already exports publicly — a duplicate surface that invites drift (the two copies can diverge). Dead exports mislead contributors ("is this the API?") and bloat the shipped surface (`files: ["src"]` ships everything). This plan removes them. All removed symbols remain obtainable: `normalizeQuestionnaire`/`AskUserValidationError`/`AskUserController` via `src/api.ts` (public), `promptSnippet`/`promptGuidelines` via `src/tool/guidance.ts` (their home).

## Current state

- `src/types.ts:115-125`:
```ts
// ── Guards ─────────────────────────────────────────────────────────
export function isChoiceQuestion(question: NormalizedQuestion): question is NormalizedChoiceQuestion {
  return question.type === "choice";
}
export function isTextQuestion(question: NormalizedQuestion): question is NormalizedTextQuestion {
  return question.type === "text";
}
```
`rg "isChoiceQuestion|isTextQuestion" src` → matches only these definitions (verified: zero usage). Note `isErrorDetails` (types.ts:127-131) IS used (render/transcript.ts:41,76) — keep it.
- `src/ui/types.ts:38-41`: `export interface RenderContext { ... }` — `rg "RenderContext" src` → matches only this definition (zero usage).
- `src/ask-user.ts:204-209`:
```ts
export { AskUserValidationError, normalizeQuestionnaire } from "./normalize.ts";
export { AskUserController } from "./session/controller.ts";
export {
  promptGuidelines as askUserPromptGuidelines,
  promptSnippet as askUserPromptSnippet,
} from "./tool/guidance.ts";
```
`src/api.ts` already exports the same three symbols (api.ts:1-3) plus aliased guidance names are never referenced anywhere (`rg "askUserPromptGuidelines|askUserPromptSnippet"` → zero hits).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `npm install` | exit 0 |
| Tests | `npx vitest run` | all pass |
| Grep | `rg "isChoiceQuestion|isTextQuestion|RenderContext|askUserPromptGuidelines|askUserPromptSnippet" src test` | no matches after the edit |

## Scope

**In scope** (the only files you should modify):
- `src/types.ts` (remove the two guard functions, keep `isErrorDetails`)
- `src/ui/types.ts` (remove `RenderContext`)
- `src/ask-user.ts` (remove the re-export block at the end)

**Out of scope** (do NOT touch, even though they look related):
- `src/api.ts` — the public re-export surface; it already covers everything.
- `src/session/controller.ts`, `src/normalize.ts`, `src/tool/guidance.ts` — the symbols' homes stay as-is.
- `README.md`, `plans/`, `test/`.

## Git workflow

- Branch: `advisor/005-remove-dead-exports`
- Commit: `chore: remove unused exports`
- Do NOT push or open a PR.

## Steps

### Step 1: Remove the dead guards from `src/types.ts`

Delete `isChoiceQuestion` and `isTextQuestion` (lines 117-125), keeping the `// ── Guards ──` header and `isErrorDetails`. Confirm `isChoiceQuestion`/`isTextQuestion` types are not used in `src/render/`, `src/ui/`, or `test/` with the grep below.

**Verify**: `rg "isChoiceQuestion|isTextQuestion" src test` → no matches.

### Step 2: Remove `RenderContext` from `src/ui/types.ts`

Delete the interface (lines 38-41) and, if the import block above it exists solely for it, clean that too.

**Verify**: `rg "RenderContext" src test` → no matches.

### Step 3: Remove the re-export block from `src/ask-user.ts`

Delete lines 204-209 (the trailing `export { ... }` statements). Do not touch the imports at the top of the file.

**Verify**: `rg "askUserPromptGuidelines|askUserPromptSnippet" src test` → no matches.

### Step 4: Full suite

**Verify**: `npx vitest run` → all pass. (If plan 004 has landed: `npm run typecheck` and `npm run lint` exit 0.)

## Test plan

- No new tests. The suite must stay green; the greps above are the regression check (a resurrected reference would be a compile/test error).

## Done criteria

All must hold:

- [ ] The three greps return nothing
- [ ] `npx vitest run` passes
- [ ] Only `src/types.ts`, `src/ui/types.ts`, `src/ask-user.ts` modified

## STOP conditions

Stop and report back (do not improvise) if:

- Any of the greps return a usage you didn't expect (the analysis was wrong — report, don't delete).
- Removing `RenderContext` breaks another file via a type-only import you missed (restore it and report).

## Maintenance notes

- `src/api.ts` is the single public re-export surface going forward; new public symbols should be added there.
- If a future consumer needs `promptGuidelines`/`promptSnippet`, they import from `@qmahyar/pi-ask` has no entry for it — the symbols live in `src/tool/guidance.ts` and are consumed internally; expose via `api.ts` only if a real need appears.