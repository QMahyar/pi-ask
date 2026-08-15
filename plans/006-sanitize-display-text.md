# Plan 006: Sanitize control characters in display text

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. Do NOT update `plans/README.md`; the reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat d8926ca..HEAD -- src test`
> If any file under `src/` or `test/` changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `d8926ca`, 2026-08-15

## Why this matters

`normalizeDisplayText` (src/normalize.ts:255-261) decodes JSON-style `\uXXXX` escapes that models emit literally — `String.fromCharCode(0x1b)` produces a raw ESC character. That string flows through pi-tui's `wrapTextWithAnsi`/`Markdown`/`truncateToWidth` renderers, which are ANSI-aware (they preserve escape sequences, not strip them), straight into the user's terminal. A model emitting `\u001b[31m` in a label/header/prompt injects ANSI control sequences into the terminal. The same decode produces lone surrogates for `\uD83D\uDE00`-style pairs (mojibake instead of emoji). Display text is untrusted input (it originates from the model's tool call); strip the control characters and replace lone surrogates.

## Current state

- `src/normalize.ts:254-266`:
```ts
/** Decodes JSON-style Unicode escapes that models sometimes emit literally in display text. */
function normalizeDisplayText(value: string): string {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_escape, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .trim();
}

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value === undefined ? undefined : normalizeDisplayText(value);
  return trimmed ? trimmed : undefined;
}
```
- `normalizeDisplayText` is applied to: question `header`, `prompt`, option `label`, `description`, `details`, `recommendation`, `placeholder` — everything user-visible (via `validateCommonFields` :81-103, `normalizeOptions` :180-200, `normalizeText` :147-163).
- pi-tui renderers (`wrapTextWithAnsi`, `truncateToWidth`, `Markdown`) preserve ANSI sequences for width measurement — they do NOT sanitize.
- Legit newlines (`\n`) and tabs (`\t`) in prompts must survive (multi-line prompts and details exist by design).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `npm install` | exit 0 |
| Tests | `npx vitest run` | all pass |

## Scope

**In scope** (the only files you should modify):
- `src/normalize.ts` (the `normalizeDisplayText` function only)
- `test/normalize.test.ts` (add tests)

**Out of scope** (do NOT touch, even though they look related):
- `src/ui/`, `src/render/`, pi-tui itself — the sanitization happens at the normalization boundary, by design.
- `src/schema.ts` (no change to the model-facing schema).
- `plans/`, `README.md`, other `src/` files.

## Git workflow

- Branch: `advisor/006-sanitize-display-text`
- Commit: `fix: strip control characters from display text`
- Do NOT push or open a PR.

## Steps

### Step 1: Sanitize in `normalizeDisplayText`

Change `normalizeDisplayText` so that after the `\uXXXX` decode (keep it — models genuinely emit these), it:

1. **Strips C0 control characters except `\n` and `\t`** — i.e. removes `\u0000-\u0008`, `\u000B`, `\u000C`, `\u000E-\u001F`, and `\u007F` (DEL). This removes ESC (`\u001B`) and everything else in the C0 range while preserving newlines and tabs. Use a single regex:
```ts
.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
```
2. **Replaces lone surrogates with U+FFFD** (REPLACEMENT CHARACTER), so `\uD83D\uDE00` decoded via two `String.fromCharCode` calls becomes two replacement chars instead of an invalid lone-surrogate pair:
```ts
.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD")
```
3. Keep the existing `.trim()`.

**Verify**: `npx vitest run` → existing tests still pass.

### Step 2: Add tests to `test/normalize.test.ts`

Add a new `describe("normalizeDisplayText sanitization", ...)` block. Import nothing new (drive it through `normalizeQuestionnaire` — the exported public path):

1. A choice question whose option label contains a literal `\u001b[31m` escape text → normalized label contains NO ESC character and no `[31m`… wait — `[31m` is printable text; assert specifically that `label.includes("\u001b")` is false. Use a label like `"Bad\u001b[31mLabel"` written as a JS string with an actual ESC char in the source: `const label = "Bad\u001b[31mLabel";` — here `\u001b` in the *test source* IS an ESC char, which also verifies raw-ESC stripping (not just the escape-text path). Then also assert the escape-text path: a label containing the literal characters `\u001b` (backslash-u-0-0-1-b) is decoded then stripped.
2. Newlines survive: header `"Line1\nLine2"` → `"Line1\nLine2"`.
3. Tabs survive: `"a\tb"` → `"a\tb"`.
4. Lone surrogate: label `"A\uD83D lone"` (with the actual lone high surrogate in source) → result contains `\uFFFD`, not `\uD83D`.

Follow the existing test style (`it`, `expect`, `toThrow` for invalid where relevant). All these go through valid questionnaires (2+ choice options).

**Verify**: `npx vitest run` → all tests pass, including the 4 new cases.

## Test plan

- New tests: 4 cases above in `test/normalize.test.ts`.
- Existing tests must stay green.

## Done criteria

All must hold:

- [ ] `npx vitest run` exits 0, including the new sanitization tests
- [ ] `rg "\\u001b" src/normalize.ts` shows the control-stripping regex present
- [ ] Only `src/normalize.ts` and `test/normalize.test.ts` modified

## STOP conditions

Stop and report back (do not improvise) if:

- Stripping control characters breaks an existing test (e.g. something legitimately relies on control chars — report).
- The surrogate replacement regex is rejected by the environment (lookbehind `(?<!...)` requires a modern engine — node 20+ is fine; if it fails, report rather than substituting a different approach without approval).

## Maintenance notes

- This only covers the C0 range + DEL + lone surrogates. C1 controls (`\u0080-\u009F`) and OSC/CSI sequences are out of scope — a literal `\u009B` (C1 CSI) followed by printable text would still render oddly; revisit only if models actually emit C1 escapes.
- The boundary is `normalize` — anything that renders raw (transcript of a tool *result* echoed by the host) is the host's concern, not this package's.
- If valid emoji decode (surrogate pairs) ever matters, the decode regex would need pair-aware handling — recorded here deliberately deferred.