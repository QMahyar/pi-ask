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

Headless sessions (print/RPC without UI) error out with a clear message — `ask_user` requires the interactive TUI.

### Deprecated fields

Top-level `allowPartialSubmit` and choice `required` / `initial` / `allowOther` (text `required` / `initial`) are rejected with a clear error pointing at the replacement — use `recommendation` for suggested answers and the `needs_discussion` outcome for unanswered questions.

### Text input

When the host TUI exposes a custom editor component, text answers use it; otherwise a built-in fallback editor handles input.

### Config

Optional prompt-surface overrides live in pi config under an `ask-user` section:

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

- `$reset` — array of field names to restore to package defaults before other overrides apply
- `prependPromptGuidelines` / `appendPromptGuidelines` — string arrays inserted before / after `promptGuidelines`
- `description` / `promptSnippet` — direct overrides of the tool description and prompt snippet

### Events

The extension emits `pi-ask:ask-user:start` and `pi-ask:ask-user:end` on `pi.events` (payload `{ source: "pi-ask" }`), bracketing each form run — useful for consumers to track decision points.

## Development

```bash
npm install
npm test        # vitest — validation/normalization checks
npm run check   # npm pack --dry-run
```

## License

MIT. This package is a derived work of [supi](https://github.com/mrclrchtr/supi) (MIT, Marcel Richter); see [LICENSE](LICENSE).