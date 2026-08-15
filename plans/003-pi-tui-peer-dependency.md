# Plan 003: Declare @earendil-works/pi-tui peer dependency

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. Do NOT update `plans/README.md`; the reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat d8926ca..HEAD -- package.json src`
> If `package.json` or `src/` changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: deps
- **Planned at**: commit `d8926ca`, 2026-08-15

## Why this matters

Six files import `@earendil-works/pi-tui` at runtime (render/transcript.ts:2, ui/form-component.ts:11, ui/form-render-primitives.ts:2, ui/form-render.ts:2, ui/form-review-render.ts:2, ui/types.ts:6) — but package.json declares it nowhere. Consumers get it only because `@earendil-works/pi-coding-agent` happens to depend on it (npm ls: pi-coding-agent@0.84.1 → pi-tui@0.84.1). That is transitive hoisting luck, not a contract: a consumer installing pi-ask against a pi-coding-agent version that drops or relocates pi-tui breaks at import. Declaring it as an optional peer (mirroring the existing `pi-coding-agent` pattern) makes the contract explicit without forcing npm to install a duplicate copy.

## Current state

- `package.json:31-42`:
```json
"peerDependencies": {
  "@earendil-works/pi-coding-agent": "*",
  "typebox": "*"
},
"peerDependenciesMeta": {
  "@earendil-works/pi-coding-agent": {
    "optional": true
  },
  "typebox": {
    "optional": true
  }
},
```
- `@earendil-works/pi-tui` is NOT in devDependencies either; it resolves transitively via `@earendil-works/pi-coding-agent@0.84.1` (verify with `npm ls @earendil-works/pi-tui`).
- Rationale for `optional: true`: the `./api` entry (`src/api.ts`) does not import pi-tui — pure-API consumers need neither pi-coding-agent nor pi-tui. Extension consumers always have pi-tui (it ships with pi-coding-agent). So pi-tui is present exactly when needed; marking it required would make npm warn/auto-install a duplicate for api-only consumers.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `npm install` | exit 0 |
| Tests | `npx vitest run` | all pass |
| Tree check | `npm ls @earendil-works/pi-tui` | resolves, no "extraneous" |
| Pack check | `npm pack --dry-run` | exit 0 |

## Scope

**In scope** (the only files you should modify):
- `package.json` (peerDependencies + peerDependenciesMeta only)

**Out of scope** (do NOT touch, even though they look related):
- `package-lock.json` — `npm install` will update it if needed; accept the change.
- `src/`, `test/`, `README.md`, any `plans/` file.

## Git workflow

- Branch: `advisor/003-pi-tui-peer`
- Commit: `fix: declare @earendil-works/pi-tui as an optional peer dependency`
- Do NOT push or open a PR.

## Steps

### Step 1: Edit `package.json`

1. In `peerDependencies`, add `"@earendil-works/pi-tui": "*"` (alphabetical: before `@earendil-works/pi-coding-agent`? Keep the existing order and append after it — do not reorder existing keys).
2. In `peerDependenciesMeta`, add:
```json
"@earendil-works/pi-tui": {
  "optional": true
},
```
Keep the existing structure exactly otherwise. Use 2-space indentation matching the file.

**Verify**: `npm install` exits 0; `npm ls @earendil-works/pi-tui` shows the transitive resolution without errors; `npx vitest run` passes.

### Step 2: Pack check

**Verify**: `npm pack --dry-run` exits 0 and its Tarball Contents list includes `package.json` (it always does) — the point is the manifest is valid JSON with the new fields.

## Test plan

- No new tests. Existing suite (`npx vitest run`) must stay green — the change is manifest-only.

## Done criteria

All must hold:

- [ ] `npm ls @earendil-works/pi-tui` exits 0 (no "extraneous", no "missing")
- [ ] `npx vitest run` passes
- [ ] `package.json` peerDependencies + peerDependenciesMeta contain `@earendil-works/pi-tui` with `optional: true`
- [ ] No `src/`, `test/`, or `plans/` files modified

## STOP conditions

Stop and report back (do not improvise) if:

- `npm install` errors on the peer declaration (registry/network aside, report the error).
- You find `@earendil-works/pi-tui` already declared somewhere in package.json (drift).

## Maintenance notes

- If pi-tui ever becomes a hard runtime requirement for the `./api` entry, drop `optional: true`.
- When pi-coding-agent bumps pi-tui versions, the peer `"*"` stays valid (host provides it).