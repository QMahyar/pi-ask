# Plan 008: Document hidden features in README

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. Do NOT update `plans/README.md`; the reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat d8926ca..HEAD -- README.md src`
> If `README.md` or `src/` changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `d8926ca`, 2026-08-15

## Why this matters

The package ships several real features that README.md doesn't mention: emitted events, extra config fields (`$reset`, `prependPromptGuidelines`), deprecated-field rejection, /tree labeling, and custom-editor support. Consumers can't know they exist (events, custom editor) or will hit them as confusing errors (rejected fields). README is the package's contract — undocumented surface reads as accidental and gets "cleaned up" by mistake later.

## Current state

- `README.md` structure (75 lines): Features (9 bullets), Install, Usage, Config (shows `tools.ask_user.promptSurface` with `description` + `appendPromptGuidelines`), Development, License.
- Features verified in code:
  1. **Events**: `pi.events.emit("pi-ask:ask-user:start", { source: "pi-ask" })` before the form runs and `"pi-ask:ask-user:end"` in the `finally` block (src/ask-user.ts:138, 176).
  2. **Config fields**: `$reset` — array of field names to reset to package defaults before applying overrides (src/core/config/prompt-surface.ts:166-168); `prependPromptGuidelines` — prepended to `promptGuidelines` (:197-204); `appendPromptGuidelines` — appended (:206-213); also `description` and `promptSnippet` overrides (:170-186).
  3. **Deprecated-field rejection** (src/normalize.ts:18-20): top-level `allowPartialSubmit`; choice `required`, `initial`, `allowOther`; text `required`, `initial` — each throws `AskUserValidationError` with a message pointing at the replacement.
  4. **Tree labeling**: completed ask_user tool results are labeled `decision`, visible/filterable in pi's `/tree` (src/ask-user.ts:43-64).
  5. **Custom editor**: when the host UI provides `getEditorComponent`, text answers use the host's editor; otherwise a built-in fallback editor is used (src/ask-user.ts:144-149, src/ui/form-component.ts:600-628).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests | `npx vitest run` | all pass (unaffected, but verify) |
| Read | (none — docs only) | — |

## Scope

**In scope** (the only file you should modify):
- `README.md`

**Out of scope** (do NOT touch, even though they look related):
- `src/`, `test/`, `package.json`, `plans/` files.
- Rewriting existing README sections — add to them only.

## Git workflow

- Branch: `advisor/008-document-features`
- Commit: `docs: document events, config fields, and editor behavior`
- Do NOT push or open a PR.

## Steps

### Step 1: Extend the Config section

In the Config section (after the existing JSON example), add a short "Additional fields" block documenting (2-3 lines each, matching README tone):

- `$reset`: array of prompt-surface field names to restore to package defaults before other overrides apply.
- `prependPromptGuidelines` / `appendPromptGuidelines`: string arrays inserted before/after `promptGuidelines`.
- `description` / `promptSnippet`: direct overrides (the existing example only shows `description` + `appendPromptGuidelines`).

### Step 2: Add a "Deprecated fields" note

Near the Usage section, add 2-3 lines: `allowPartialSubmit` (top level) and `required`, `initial`, `allowOther` (choice questions) / `required`, `initial` (text questions) are rejected with a clear error; use `recommendation` for suggested answers and the `needs_discussion` outcome for unanswered questions.

### Step 3: Add an "Events" subsection

Document that the extension emits `pi-ask:ask-user:start` and `pi-ask:ask-user:end` on `pi.events` (payload `{ source: "pi-ask" }`), bracketing the form run — useful for consumers to track decision points.

### Step 4: Add a "Session integration" detail

The Features section's last bullet mentions `ask_user` entries in the transcript. Add one line: completed forms are also labeled `decision` in `/tree`.

### Step 5: Add a "Custom editor" note

In the Usage section (or a new short "Text input" note): when the host TUI exposes a custom editor component, text answers use it; otherwise a built-in fallback editor handles input.

**Verify**: `npx vitest run` still passes (docs-only change; confirm nothing else drifted).

## Test plan

- None. Verification is manual README review.

## Done criteria

All must hold:

- [ ] README documents: `$reset`, `prependPromptGuidelines`/`appendPromptGuidelines`, `description`/`promptSnippet` overrides, deprecated-field rejection, both events, `/tree` labeling, custom-editor behavior
- [ ] Existing README sections intact (only additions)
- [ ] No files other than `README.md` modified

## STOP conditions

Stop and report back (do not improvise) if:

- Any documented behavior doesn't match the "Current state" excerpts (drift — report, don't document a guess).
- The README has been restructured by another plan (merge it with your additions).

## Maintenance notes

- Events are an extension of pi's event system; if pi changes its event API, these docs must follow.
- If the deprecated fields are ever re-enabled, remove the note.
- Keep Config docs in sync with `src/core/config/prompt-surface.ts` — it's the only source of truth for field semantics.