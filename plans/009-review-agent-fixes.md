# Plan 009: Fix review-agent findings (10-agent review of pi-ask)

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. Do NOT update `plans/README.md`; the controller maintains the index.
>
> **Drift check (run first)**: `git diff --stat 0973e00..HEAD -- package.json src test`
> If `package.json`, `src/`, or `test/` changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MEDIUM
- **Depends on**: none
- **Category**: review-fixes
- **Planned at**: commit `0973e00`, 2026-08-16

## Why this matters

Ten review agents (each grounding on pi 0.84.x docs: `extensions.md`, `packages.md`, `sessions.md`, `session-format.md`, `tui.md`, `security.md`, `rpc.md`, `settings.md`, `environment-variables.md`) reviewed this extension and produced findings. This plan fixes the accepted findings. Findings deliberately rejected are listed in "Findings considered and rejected" (the controller owns that list).

## Global Constraints

These bind every task:

1. Do not modify any file outside the task's scope. Do not touch `plans/README.md` (controller-owned).
2. The pi docs are authoritative for API usage. Before changing any pi-facing behavior, consult the installed docs at `node_modules/@earendil-works/pi-coding-agent/docs/` (pi 0.84.2) and the shipped `.d.ts` types.
3. After every change: `npm test` (vitest) must pass, `npm run typecheck` (tsc --noEmit) must pass, `npm run lint` (biome) must pass.
4. No new runtime dependencies. DevDependencies may be added only with the controller's prior approval.
5. Keep existing patterns: limits centralized in `src/types.ts` (`ASK_USER_LIMITS`), sanitization via `normalizeDisplayText`/`trimOptional` in `src/normalize.ts`, validation errors as `AskUserValidationError` with model-actionable messages.
6. Do not change public tool-arg field names or the `ask_user` tool name (breaking change for installed users).
7. Commit your work with clear messages (repo style: `fix: ...`, `test: ...`, `docs: ...`, `chore: ...`).

## Task 1: Tool lifecycle, labeling, and lock hardening

**Current state**: `src/ask-user.ts` — tool_result handler labels every result `"decision"` (lines 47-64, no `event.isError` check); the label is applied via `setTimeout(0)` without try/catch (a teardown race can throw an uncaught timer exception and crash pi, and a yielding event loop can skip the label silently); `signalAttention` + `pi.events.emit("pi-ask:ask-user:start")` run between `lock.acquire()` (line 129) and the `try` (line 138) so a throwing listener leaks the lock; cancel and abort produce the identical message "The user interaction was cancelled."; `src/session/lock.ts` is a bare boolean with no owner or stale-lock recovery.

**Changes**:

1. `src/ask-user.ts` tool_result handler (lines 47-64): return early when `event.isError` — never label failed, cancelled, or aborted forms `"decision"`. README's "each completed form is labeled `decision`" then holds.
2. Make the deferred labeling safe and deterministic: keep the `setTimeout(0)` mechanism (documented pi behavior: the tool result entry is not in `sessionManager` yet when the handler runs) but wrap the callback body in try/catch, guard against session teardown (track a `disposed` flag set on `session_shutdown`; skip labeling if set), and never throw into the timer.
3. Move `signalAttention` and `pi.events.emit("pi-ask:ask-user:start")` inside the `try` (after `lock.acquire()`), so the `finally` (lines 172-177) releases the lock unconditionally. Keep the start event's payload `{ source: "pi-ask" }`.
4. Stale-lock recovery in `src/session/lock.ts`: add an owner token (e.g. a monotonically increasing id or the toolCallId), `acquire(owner)` returning success, and `release(owner)` / `releaseIfOwner(owner)` so a stale release cannot clear a newer form's lock. In `src/ask-user.ts`, release the lock only when the owner matches. Add an abort-signal watchdog: if the turn's `signal` aborts, release the lock for that owner (the AbortSignal is passed to `execute`; hook it in `executeAskUser`).
5. Distinguish cancel vs abort in the thrown message (`cancel` → "The user interaction was cancelled."; `abort` → keep or use "The user interaction was aborted.") so the model can tell user-Esc from a shutdown.
6. Do NOT re-scope the lock per session (deliberately rejected in plans/README.md:26 — the pi TUI is single-frontend; the process-wide form lock is intentional).

**Verification**: `npm test`, `npm run typecheck`, `npm run lint`. Add unit tests for the lock (acquire/release/releaseIfOwner/release-without-owner) in a new `test/lock.test.ts`, and for the label gate if the handler is extractable as a pure function (extract `shouldLabelDecision(event)` or equivalent; test error vs success). If the handler is not cleanly extractable, note it in the report and cover via the extracted predicate only.

**Acceptance criteria**:

- [ ] Failed/cancelled/aborted ask_user results are never labeled `decision`; successful ones still are
- [ ] The label timer cannot throw an uncaught exception; it is skipped after session teardown
- [ ] Lock is released on every path (success, cancel, abort, throw from event listeners)
- [ ] Lock has owner semantics; a stale release cannot clear a newer form's lock; abort releases the lock
- [ ] Cancel vs abort messages differ
- [ ] All checks green; lock tests added

**Out of scope**: per-session locking, any change to `executionMode`, event payload shape changes.

## Task 2: Form keyboard handling and scrolling

**Current state**: `src/ui/form-component.ts` compares raw `data === "c"` / `"u"` / `"n"` (lines 264, 305, 311, 316, 326, 332) — pi-tui enables the Kitty keyboard protocol (flag 1) on supporting terminals, where a plain `c` arrives as the CSI-u sequence `\x1b[99u`, so these shortcuts silently stop working on WezTerm/Ghostty/Warp; Esc arms an 80ms `pendingEsc` timer (lines 151-158) that (a) is not cleared on Tab/Shift+Tab navigation (cancels the whole turn ~80ms later), (b) is not cleared on `dispose()` (line 232), and (c) in text mode the `u`/`c` branches fall through to `editor.handleInput` (line 352), typing the letter into the answer; Ctrl+C is swallowed in choice/review modes instead of cancelling (lines 105-133); PageUp/PageDown/Home/End are unhandled (pi's `SelectList` uses them); the form content can exceed the viewport with no scrolling, hiding the Submit card and lower questions on short terminals.

**Changes**:

1. Decode printable keys once at the top of the input handler: use pi-tui's `decodePrintableKey` (check the export in `node_modules/@earendil-works/pi-tui/dist/`; `keys.js`/`keys.d.ts` — fall back to `matchesKey` from pi-tui which handles both raw and CSI-u forms) and compare the decoded key. Do this once per input event, then keep the existing `data === ...` comparisons against the decoded value. Verify the exact helper name from pi-tui's exports before using it.
2. Esc-then-`u`/`c` double action: `return` after the `pendingEsc` branches in `handleTextKey` so the letter is not also typed into the answer.
3. Clear `pendingEsc` (clearTimeout + null) in `navigateForward`/`navigateBackward`/`goNext` and in `dispose()`; guard the timer callback against firing after close (the `closed` flag already exists — check it before acting).
4. Ctrl+C in choice and review modes cancels the form (call `controller.cancel()` + `finish()`), matching pi's `tui.select.cancel` behavior. Keep Ctrl+C as copy inside the text editor.
5. Add PageUp/PageDown/Home/End handling for the choice list and the review list (jump to first/last or ±5 items) using `matchesKey(data, Key.pageUp)` etc., consistent with pi's SelectList bindings (`keybindings.d.ts`: `tui.select.pageUp/pageDown`).
6. Scrolling for tall content: implement an internal scroll offset (e.g. `scrollOffset`) in the form component for the question list and the review screen, clamping to content height, paged by PageUp/PageDown and jumped by Home/End, with a scroll indicator when content is clipped (e.g. `▾ N more` / `↑ N hidden`). Content height must be computed against the actual available height (the component receives size via the pi-tui component lifecycle — check how the host sizes the editor container; `interactive-mode.js` uses `shrink: 1, minSize: 3`). Do not break the width-truncation discipline (all render paths truncate via `truncateToWidth`/`wrapTextWithAnsi`).
7. Vim-mode hint (optional, Low): if the editor uses `handlesEscape`, the footer "Esc cancel" hint is misleading; adjust the hint when the custom editor handles Escape, or document. Only if cheap.

**Verification**: `npm test`, `npm run typecheck`, `npm run lint`. The UI files have zero test coverage today; if the key-decoding/scrolling logic can be extracted into pure functions (e.g. `nextFocusIndex`, `clampScroll`), extract and test them in `test/` (e.g. `test/ui-logic.test.ts`). The component itself stays untested (pi-tui rendering not unit-testable here).

**Acceptance criteria**:

- [ ] `c`/`u`/`n` shortcuts work under Kitty-protocol terminals (decoded before comparison)
- [ ] Esc+`u`/`c` does not type the letter; Esc+Tab does not cancel the turn; pendingEsc cleared on dispose
- [ ] Ctrl+C cancels in choice/review modes
- [ ] PageUp/PageDown/Home/End navigate lists
- [ ] Tall content scrolls with a visible clip indicator; Submit card reachable on short terminals
- [ ] All checks green; pure UI logic tested

**Out of scope**: restyling the form, theme changes, new keybindings beyond the ones listed.

## Task 3: Sanitization, schema, limits, and error messages

**Current state**: `normalizeDisplayText` (src/normalize.ts:251-262) strips C0 controls and lone surrogates but NOT C1 controls (0x80-0x9F, which many terminals interpret as control sequences) or bidi overrides (U+202A-202E, U+2066-2069); `renderAskUserCall` (src/render/transcript.ts:27-34) renders raw model args (title/headers) without sanitization and without `context.argsComplete` guarding; user answers/comments (src/session/controller.ts:102-111, 171-177) are stored raw; option `label`/`description`/`details`, question `id`, option `value`, and `recommendation` have no length limits (src/types.ts:103-113 caps only questions 1-10, options 2-12, header 60, prompt/title/intro 4000/120/4000, placeholder 200); the schema (src/schema.ts:31-62) uses `Type.Union`/`Type.Literal` discriminators which per extensions.md:2002 are not Google/Gemini compatible (use `StringEnum` from `@earendil-works/pi-ai`); a hallucinated `needs_discussion` input field passes validation silently; deprecation errors (normalize.ts:109-113, 139-143) all say "use recommendation" even for `required` (real replacement: the `needs_discussion` outcome) and `allowOther` (real replacement: a text question); `needs_discussion` output identifies unanswered questions by header text only (result.ts:87) and headers are not unique-checked; `normalizeQuestionnaire` (normalize.ts:39, 82) throws raw `TypeError` on missing `questions`/`id` at the public API; answer formatting is duplicated (`formatAnswerLine` transcript.ts:148-164 vs `formatAnswerSummaryLine` result.ts:111-128); `selectChoiceOption` (controller.ts:145-147) out-of-bounds index silently deselects everything.

**Changes**:

1. Extend the strip set in `normalizeDisplayText` to C1 (`\u0080-\u009F`) and bidi controls (`\u202A-\u202E`, `\u2066-\u2069`), keeping the existing `\uXXXX` decode-then-strip order. Update/extend the sanitization tests.
2. `renderAskUserCall` (transcript.ts): sanitize `title` and each `header` through the display sanitizer before rendering; guard against malformed/partial args (check `context.argsComplete` or defensively shape-check `args.questions` before mapping).
3. Sanitize user-answer and comment text at input time in the controller (`setTextAnswer`, comment setters) using the same display sanitizer, so stored/rendered/persisted values are clean.
4. Add length limits for option `label` (e.g. 200), `description` (e.g. 1000), `details` (e.g. 2000), option `value` (e.g. 200), question `id` (e.g. 100), and `recommendation` items (e.g. 200) to `ASK_USER_LIMITS` in `src/types.ts` and enforce them in `src/normalize.ts` with `AskUserValidationError` messages that list the offending id. Keep the enforcement normalize-side only (schema-level maxLength would front-run the clear error messages with generic TypeBox failures — do not add schema maxLength).
5. Google/Gemini compatibility: replace the `Type.Literal("choice"|"text")` and other union/literal discriminators in `src/schema.ts` per extensions.md:2002 — use `StringEnum` from `@earendil-works/pi-ai` where pi's docs prescribe it. Check how `StringEnum` is exported (pi-ai is a pi-bundled core package; if importing it at runtime, declare `@earendil-works/pi-ai` as an optional peerDependency in package.json — check what's already there first and see Task 4's packaging constraints; if pi-ai is not safely importable, flatten the discriminator to an optional plain `type` string field validated in normalize instead — choose the doc-grounded option and note the ruling in the report). For the `recommendation` union (`string | string[]`): if a union cannot be expressed Google-safely, declare the schema field as string-array and normalize a plain string into `[string]` (normalize already handles this via `resolveIndexes`); keep the public API accepting both.
6. Hallucinated-field rejection: `needs_discussion` (and any other known-input-field names that are actually outputs — check guidance.ts:15 which invites the model to pass it) must produce a clear `AskUserValidationError` ("`needs_discussion` is an output field; the tool returns it when questions are unanswered — do not pass it") instead of silent acceptance. Also reword `src/tool/guidance.ts` so the output-field wording cannot be misread as an input. Do NOT add `additionalProperties: false` to the schemas — the deprecated-field rejection design depends on unknown keys reaching normalize.
7. Per-field deprecation messages: `required` → point at the `needs_discussion` outcome; `allowOther` → point at a text question; `initial` → `recommendation`. Keep top-level `allowPartialSubmit` message pointing at `needs_discussion`.
8. Duplicate headers: add a normalize validation error for duplicate question `header`s (they are shown to the user and echoed in results). `needs_discussion` output in `result.ts` should identify unanswered questions as `id: header` (fall back to header alone if id is absent).
9. Public-API guards in `normalizeQuestionnaire`: missing/non-array `questions`, missing/non-string `id` → `AskUserValidationError` instead of raw `TypeError`.
10. Extract one shared helper (e.g. `formatSelectedOptions(options, selected, comment)`) used by both `formatAnswerLine` and `formatAnswerSummaryLine`; put it where both render files can import it (e.g. a shared module or one of the render files — follow existing import style).
11. Guard `selectChoiceOption` against out-of-bounds `optionIndex` (no-op or throw `AskUserValidationError`, matching `setChoiceOptionComment`'s behavior at controller.ts:131-132).
12. Remove the dead `AskUserErrorDetails` type (`src/types.ts:82-87`) or wire it to the cancel case — choose the smaller change; if it is genuinely unreachable, delete it and its consumer branches (transcript.ts:42,77).

**Verification**: `npm test`, `npm run typecheck`, `npm run lint`. Extend `test/normalize.test.ts` for every new limit and message; extend `test/controller.test.ts` for the OOB guard and sanitized answers; add tests for the transcript/result formatting helpers if extractable.

**Acceptance criteria**:

- [ ] C1 + bidi controls stripped everywhere display text is sanitized
- [ ] renderCall and user answers/comments sanitized
- [ ] All new length limits enforced with clear messages; limits centralized in types.ts
- [ ] Schema no longer uses `Type.Union`/`Type.Literal` for the discriminator (StringEnum or flattened per ruling); recommendation stays string|string[] at the public API
- [ ] `needs_discussion` as input is rejected with a clear message; guidance reworded
- [ ] Per-field deprecation messages correct; duplicate headers rejected; needs_discussion lists `id: header`
- [ ] `normalizeQuestionnaire` never throws raw TypeError on missing questions/id
- [ ] Shared answer-formatting helper; OOB select guard; dead type removed
- [ ] All checks green

**Out of scope**: schema `additionalProperties: false` (deliberate — see change 6), new public fields, changing existing limit values already in `ASK_USER_LIMITS`.

## Task 4: Packaging, entry renderer, README truth, plans index

**Current state**: `package.json` — `@earendil-works/pi-tui` is imported at runtime by 6 files (src/render/transcript.ts:2, src/ui/form-component.ts:10, form-render-primitives.ts:2, form-render.ts:2, form-review-render.ts:2, ui/types.ts:6) but declared only as a devDependency (packages.md:171 requires listing pi-bundled core packages as peers; the declaration was dropped in 1.1.1); `exports` has no `"."` root so `main: "src/api.ts"` is dead and `import "@qmahyar/pi-ask"` throws `ERR_PACKAGE_PATH_NOT_EXPORTED`; the `@qmahyar/pi-ask/api` subpath is undocumented; `src/ask-user.ts:167-170` appends a custom `ask_user` session entry but no `registerEntryRenderer` is registered, so the entry is invisible in the transcript while README.md:16 claims "completed forms appear as `ask_user` entries, expandable in the transcript"; README under-documents limits, cancel behavior, no-pre-selection behavior, `/reload` requirement after config edits, and the API entry; README.md:41's "print/RPC without UI" wording is imprecise (any non-TUI mode errors); `plans/README.md` status table is stale (plans 001-008 all executed but marked TODO).

**Changes**:

1. `package.json`: re-declare `"@earendil-works/pi-tui": "*"` in `peerDependencies` and add it to `peerDependenciesMeta` with `"optional": true` (mirrors plan 003, which 1.1.1 reverted — ruling: three independent review agents confirmed packages.md:171 requires it, and `optional: true` avoids forcing duplicate installs for api-only consumers). Keep existing key order/format.
2. `package.json` `exports`: add `".": "./src/api.ts"` as the root entry (keep `./api` for back-compat); keep `main` as-is (now honored). Add `"types"` handling only if cheap and unambiguous — otherwise leave and document the TS-module-resolution requirement in README.
3. Register a minimal `pi.registerEntryRenderer("ask_user", ...)` in the extension (check the documented signature in extensions.md/session-format.md and an example renderer, e.g. examples/extensions/entry-renderer.ts) rendering the entry's `{title, questions}` data (title + question count, expandable if the renderer contract supports it). Wire it in `src/ask-user.ts` where the entry is appended (factory time or session_start — follow the documented pattern).
4. README updates (all claims must match code):
   - Add a "Limits" section: 1-10 questions, 2-12 options per choice question, header ≤60, title ≤120, intro ≤4000, prompt ≤4000, placeholder ≤200, and the new limits from Task 3 (label/description/details/value/id/recommendation), duplicate id/value/header rejection, empty-field rejection.
   - Add a "Behavior" section: cancel aborts the turn (model sees "The user interaction was cancelled."); single-select questions are NOT pre-selected without a `recommendation`; config edits require `/reload` or a new session; the custom `ask_user` transcript entry and the expandable tool-result row.
   - Fix line 41: "Headless sessions (print/JSON/RPC/SDK without TUI) error out with a clear message" (any non-TUI mode).
   - Add an "API" section documenting `import { ... } from "@qmahyar/pi-ask"` (root) and `@qmahyar/pi-ask/api`, the typebox peer requirement, and the TS-source/loader note.
   - Config section: note the `$reset` layering behavior (see Task 5 — coordinate), `promptGuidelines` full-replace override, and that unknown keys are diagnosed (see Task 5).
   - README "Deprecated fields" section: align with the corrected per-field messages from Task 3.
5. `plans/README.md` — do NOT edit (controller-owned; the controller updates the index at merge time).

**Verification**: `npm test`, `npm run typecheck`, `npm run lint`, `npm pack --dry-run` (exit 0, pack contents still include all export targets). No test changes required unless the renderer is extractable — if the entry renderer is a pure function of `{title, questions}`, add a small unit test.

**Acceptance criteria**:

- [ ] pi-tui optional peer declared (packages.md:171 compliant); `npm ls @earendil-works/pi-tui` clean
- [ ] `import "@qmahyar/pi-ask"` resolves (root export); `./api` still works
- [ ] `ask_user` custom entry renders in the transcript (renderer registered)
- [ ] README Limits/Behavior/API sections accurate and matching code; line 41 wording fixed; deprecation section aligned with Task 3 messages
- [ ] All checks green; pack dry-run clean

**Out of scope**: plans/README.md edits, CHANGELOG creation, version bumps, publishing.

## Task 5: Config system hardening

**Current state**: `src/core/config/config.ts:12-18` hardcodes the global config path from `os.homedir()` and ignores `PI_CODING_AGENT_DIR` / `getAgentDir()` (documented in environment-variables.md:81; `getAgentDir` is a package export that honors it); `src/core/config/prompt-surface.ts:67-86` reads+parses+validates the project config before the trust gate, so an untrusted project's `.pi/pi-ask/config.json` is parsed (memory DoS) and can emit warnings the user never opted into; `readJsonFile` (config.ts:28-31) swallows all fs errors including EACCES; unknown keys at every config level fail silently (a typo'd field makes the override a silent no-op — the worst failure mode of the feature); `$reset` at project scope restores package defaults, silently discarding global-scope overrides; the diagnostics-dedup `Set` on `globalThis` (prompt-surface.ts:116-127) grows unboundedly per session; `$reset` placed as a sibling of `promptSurface` inside `tools.ask_user` is silently ignored.

**Changes**:

1. Global path: use `getAgentDir()` from `@earendil-works/pi-coding-agent` (check it is exported from the package index; if not, use `process.env.PI_CODING_AGENT_DIR` with the documented default `~/.pi/agent` fallback) instead of hardcoding `path.join(os.homedir(), ".pi", "agent")`. Keep the project path (`.pi/pi-ask/config.json` via `CONFIG_DIR_NAME`) unchanged.
2. Trust-gate ordering: do not read/parse/validate the project config until after the trust check. Reorder so untrusted project configs are skipped entirely (no parse, no diagnostics). Keep the existing trust semantics exactly (markerless project + `.pi/pi-ask/config.json` → refused with the existing diagnostic; `hasTrustRequiringProjectResources(cwd) && ctx.isProjectTrusted()`).
3. `readJsonFile`: swallow only ENOENT; other errors (EACCES, EISDIR) become a warn diagnostic instead of silent ignore. Keep the diagnostic style (warn + ignore) — do not crash.
4. Unknown-key diagnostics: track visited keys at every level (section → `tools` → toolName → `promptSurface` → field) and emit a `invalidPromptSurfaceField`/`invalidPromptSurfaceConfig` diagnostic for unknown keys (including `$reset` as a sibling of `promptSurface` inside a tool entry). Follow the existing diagnostic shape (see `notifyToolPromptSurfaceDiagnostics`, prompt-surface.ts:112-127).
5. `$reset` layering: change semantics so a project-scope `$reset` restores the field to the state as resolved from global scope (package defaults + global overrides), then applies the project's other overrides (prepend/append/fields) on top. Document the new behavior in README's config section (Task 4 covers README — carry a note in your report for the controller).
6. Prune the diagnostics-dedup `Set` on `session_shutdown` (or key it per-session runtime) so it cannot grow unboundedly.

**Verification**: `npm test`, `npm run typecheck`, `npm run lint`. Add `test/config.test.ts` (or extend existing) covering: global/project precedence, `$reset` ordering (package-defaults+global → project), prepend/append ordering, trust gate (trusted vs markerless-untrusted), unknown-key diagnostics, ENOENT vs EACCES handling. The `homeDir` option in the config loader exists for exactly this (check its signature).

**Acceptance criteria**:

- [ ] Global config honors `PI_CODING_AGENT_DIR`/`getAgentDir()`
- [ ] Untrusted project config is never read/parsed/validated
- [ ] EACCES and friends produce a diagnostic instead of silent ignore
- [ ] Unknown config keys produce diagnostics at every level
- [ ] Project `$reset` preserves global overrides; README documents the behavior
- [ ] Diagnostics Set pruned on session shutdown
- [ ] All checks green; config merge engine tested

**Out of scope**: new config fields, changes to trust-gating semantics, prompt-surface defaults.

## Task 6: Test coverage and quality gates

**Current state**: only `test/controller.test.ts` + `test/normalize.test.ts` exist (~15-20% overall coverage; `src/ui/`, `src/ask-user.ts`, `src/session/lock.ts`, `src/render/*`, `src/core/config/*`, `src/tool/guidance.ts` at 0%); no coverage tooling configured; normalize's limits/deprecated-field paths have zero tests; the schema validation path is never exercised; controller has untested branches (kind-mismatch no-ops, OOB select, questionComment in outcome, getters).

**Changes**:

1. Add the missing tests produced by Tasks 1-5 in their own files (lock, config, ui-logic, render helpers) — coordinate: this task runs LAST and must include any test files the earlier tasks created, verifying they are complete and consistent.
2. Extend `test/normalize.test.ts` with every path that is currently untested and not covered by Task 3's additions: duplicate question ids, empty id/header/prompt, id whitespace-trim, 0 and >10 question counts, 13+ options, empty option value/label, recommendation shapes (multi-with-string, single-with-array), duplicate recommendation values, `\u{...}`-style escapes not decoded (informational — pin current behavior), empty/whitespace title & intro omitted.
3. Extend `test/controller.test.ts`: kind-mismatch no-ops (`isOptionSelected`/`getOptionComment`/`setTextAnswer` on wrong question type), multi-select deselect-all → needs_discussion, question comment in outcome, `currentQuestion`/`isTerminal` getters, selected+comment serialization.
4. Exercise the schema: add a test that validates a valid payload and an over-limit payload through `AskUserParamsSchema` (TypeBox `Value.Check` or `Compile`) so the schema path is pinned (Task 3 may have changed the schema — test the final shape).
5. Extract the headless guard predicate in `src/ask-user.ts` (line 124: `!ctx.hasUI || ctx.mode !== "tui"`) into an exported pure function (e.g. `canShowForm(hasUI, mode)`) and test all five mode combos (tui, rpc, print, json, sdk-default).
6. Coverage tooling: add `@vitest/coverage-v8` as a devDependency and a `coverage` script (`vitest run --coverage`); wire nothing into CI (no CI changes — controller-owned). Report the coverage numbers in the task report.
7. Keep everything green: `npm test`, `npm run typecheck`, `npm run lint`.

**Acceptance criteria**:

- [ ] Every untested branch listed above has a test; test files from Tasks 1-5 are complete
- [ ] Headless guard predicate extracted and tested across all five modes
- [ ] Schema validation path exercised
- [ ] Coverage script runs and reports numbers; overall coverage visibly improved (report before/after)
- [ ] All checks green

**Out of scope**: CI changes, coverage thresholds, refactoring for testability beyond the headless-guard extraction and the pure-logic extractions already specified in Tasks 1-2.

## Findings considered and rejected (controller-owned; do not act on these)

- Per-process form lock re-scoping per session: rejected (plans/README.md:26 — intentional).
- `SuiPiToolPromptSurface` rename: rejected (cosmetic churn, plans/README.md:28).
- Import-extension consistency (`.ts` vs extensionless): rejected (biome enforces uniform style; no behavioral impact).
- Schema `additionalProperties: false`: rejected — it would break the deprecated-field rejection design (unknown keys must reach normalize).
- `Type.Union` recommendation field kept as-is: contingent on the StringEnum ruling in Task 3, change 5.
- Changelog file creation: out of scope for this plan.

## STOP conditions

Stop and report back (do not improvise) if:

- The installed pi docs contradict a change's premise (e.g. `StringEnum` not importable from pi-ai, `decodePrintableKey` not exported from pi-tui, `getAgentDir` not exported) — report the exact doc/type evidence instead of guessing.
- An npm install fails on the peer declaration.
- A task requires touching a file outside its scope to complete (report; the controller re-scopes).
- A test suite cannot be made green with the specified changes (report what you tried).