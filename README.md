# @qmahyar/pi-ask

Structured **[choice + text forms](https://pi.dev)** for the pi coding agent — when the agent needs your input before continuing, it pauses, shows one focused form, and resumes with structured answers.

A single `ask_user` tool: no bloat, no extra packages, no build step. Sourced from the same UI lineage as [supi](https://github.com/mrclrchtr/supi)'s ask-user, maintained here as a standalone pi package.

## Features

- **Choice and text questions** — single-choice, multi-select, freeform text
- **Up to 10 questions per form** — one decision handoff instead of scattered interruptions
- **Recommendations/prefill** — agent suggests, you can change
- **Trade-off details** — optional per-option descriptions, consequences, code samples
- **Comments at every level** — per question, option, or whole form
- **Review before submit** — inspect and edit every answer
- **Structured outcome** — `submitted` when complete; `needs_discussion` when unanswered, so the agent follows up instead of assuming
- **Session integration** — completed forms appear as `ask_user` entries, expandable in the transcript; each completed form is labeled `decision`, visible and filterable in pi's `/tree`

## Install

From npm:

```bash
pi install npm:@qmahyar/pi-ask
```

From a local checkout:

```bash
pi install ./path/to/pi-ask
```

## Usage

Tell Pi when you want a structured handoff:

> "Before scaffolding, ask me about the package manager and test runner."
> "Collect the product questions into one form with trade-offs beside each option."

The agent calls the `ask_user` tool. You answer in the form, review, submit. Pi resumes with structured responses.

Headless sessions (print/JSON/RPC/SDK — any non-TUI mode) error out with a clear message: `ask_user` requires the interactive TUI.

### Behavior

- **Cancel aborts the turn** — pressing Esc cancels the form; the turn is aborted and the model sees `The user interaction was cancelled.` (a shutdown aborts with `The user interaction was aborted.`).
- **No implicit pre-selection** — single-select questions start with nothing selected unless the agent passes a `recommendation`; unanswered questions come back as `needs_discussion` so the agent follows up instead of assuming.
- **Config edits need a reload** — prompt-surface config is resolved at session start; edits to config files take effect after `/reload` or in a new session.
- **Transcript integration** — each completed form is appended as an `ask_user` custom entry (title + question count, expandable in the transcript) and the successful tool result is labeled `decision`, visible and filterable in pi's `/tree`.

### Limits

- **1-10 questions** per form; **2-12 options** per choice question.
- Character limits: question `header` ≤ 60, `prompt` ≤ 4000, form `title` ≤ 120, `intro` ≤ 4000, text `placeholder` ≤ 200, option `label` ≤ 200, option `description` ≤ 1000, option `details` ≤ 2000, option `value` ≤ 200, question `id` ≤ 100, each `recommendation` entry ≤ 200.
- Rejected with a clear validation error: duplicate question `id`s, duplicate option `value`s, duplicate question `header`s, empty `id`/`header`/`prompt`, empty option `value`/`label`.

### Deprecated fields

Top-level `allowPartialSubmit` and `required` on either question kind are rejected with an error pointing at the `needs_discussion` outcome for unanswered questions; choice `allowOther` is rejected with an error pointing at adding a text question; `initial` on either question kind is rejected with an error pointing at `recommendation` for suggested answers.

### Text input

When the host TUI exposes a custom editor component, text answers use it; otherwise a built-in fallback editor handles input.

### Config

Optional prompt-surface overrides and behavior settings live in pi config under an `ask-user` section:

- Global: `~/.pi/agent/pi-ask/config.json`
- Project (trust-gated): `.pi/pi-ask/config.json`

```json
{
  "ask-user": {
    "tools": {
      "ask_user": {
        "promptSurface": {
          "description": "Custom tool description for the model",
          "appendPromptGuidelines": ["One extra guideline"]
        }
      }
    }
  }
}
```

Additional prompt-surface fields:

- `$reset` — array of field names to restore to package defaults before other overrides apply. At project scope, `$reset` restores a field to the state resolved from global scope (package defaults + global overrides) — it does not discard global overrides — then the project's remaining overrides apply on top. Place it inside `promptSurface`, next to the fields it resets.
- `promptGuidelines` — full-replace override of the guideline list; `prependPromptGuidelines` / `appendPromptGuidelines` insert string arrays before / after it
- `description` / `promptSnippet` — direct overrides of the tool description and prompt snippet

Behavior settings sit at the section level next to `tools` and follow the same resolution order (defaults ← global ← trusted project):

- `bell` — sound the terminal bell (BEL) when a form opens. Default `true`.

```json
{
  "ask-user": {
    "bell": false
  }
}
```

Unknown keys and invalid values at every level (`ask-user` section, `tools`, tool name, `promptSurface`) are diagnosed with a warning instead of silently ignored — a typo'd field never silently no-ops. Config changes take effect after `/reload` or in a new session.

### Events

The extension emits lifecycle events on `pi.events`, pi's inter-extension event bus — other extensions can listen with `pi.events.on(...)`. Each form run is bracketed by:

- `pi-ask:ask-user:start` — `{ source: "pi-ask" }`; emitted when a form opens.
- `pi-ask:ask-user:end` — `{ source: "pi-ask" }`; emitted when the form run ends.
- `herdr:blocked` — `{ active: true, label: string }` when the form goes on screen (`label` is the form title, or `"ask_user"` when untitled); `{ active: false }` when it ends.

`pi-ask:ask-user:end` and `herdr:blocked { active: false }` are both emitted from a `finally` block, so they fire on every end path — submit, cancel, abort, and error. Listeners can rely on them for cleanup.

```ts
pi.events.on("pi-ask:ask-user:start", (payload: { source: "pi-ask" }) => {
  // a decision form just opened
});
```

The `herdr:blocked` pair integrates with herdr, an external agent-supervisor tool: while a form is active, herdr reports the session as blocked (with the label as the message) and other agents can wait on it (`--until blocked`). This integration is optional — it is only meaningful when herdr is installed; otherwise the events are simply ignored.

### API

The package ships TypeScript sources with no build step — pi loads them natively, so no compiled output is published.

```ts
import {
  AskUserController,
  AskUserParamsSchema,
  AskUserValidationError,
  normalizeQuestionnaire,
} from "@qmahyar/pi-ask";
```

- The root export `@qmahyar/pi-ask` and the back-compat subpath `@qmahyar/pi-ask/api` expose the same surface: `normalizeQuestionnaire`, `AskUserValidationError`, `AskUserParamsSchema`, `AskUserController`, plus the normalized questionnaire and response types.
- `typebox` is a peer dependency (pi bundles it); to use `AskUserParamsSchema` outside pi, provide `typebox` yourself.
- The package ships TypeScript sources with no build step. Pi loads `.ts` natively; other consumers need a TS-aware runtime or loader — Node with `--experimental-transform-types`, `tsx`, or a bundler with `allowImportingTsExtensions` (plain `--experimental-strip-types` cannot handle `AskUserController`'s parameter properties).

## Development

```bash
npm install
npm test        # vitest — validation/normalization checks
npm run check   # npm pack --dry-run
```

## License

MIT. This package is a derived work of [supi](https://github.com/mrclrchtr/supi) (MIT, Marcel Richter); see [LICENSE](LICENSE).