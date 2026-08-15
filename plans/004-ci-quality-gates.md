# Plan 004: Add typecheck, lint, and CI gates

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. Do NOT update `plans/README.md`; the reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat d8926ca..HEAD -- package.json src test .github`
> If any in-scope file changed since this plan was written, compare against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `d8926ca`, 2026-08-15

## Why this matters

The repo has no tsconfig.json, no lint config, and no CI — `npm test` is the only gate. The code carries `// biome-ignore` comments (src/core/config/prompt-surface.ts:320,338; src/ask-user.ts:97,107) proving the author uses Biome, but nothing pins the toolchain for contributors or CI. This plan adds: a strict tsconfig + `typecheck` script, Biome config + `lint` script (matching the code's existing style), and a GitHub Actions workflow running install → typecheck → lint → test on push/PR. The typecheck will very likely surface real type errors that have been invisible — fixing those is in scope.

## Current state

- `package.json` scripts: `"test": "vitest run"`, `"check": "npm pack --dry-run"`. devDependencies: `@earendil-works/pi-coding-agent`, `@types/node`, `typebox`, `vitest`. No `@biomejs/biome`.
- No `tsconfig.json`, no `biome.json`, no `.github/` directory.
- Code style (match it): 2-space indent, single quotes, semicolons, trailing commas in multiline literals, ~100 col width (e.g. src/ask-user.ts, src/normalize.ts).
- Vitest runs TS without typechecking today.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `npm install` | exit 0 |
| Add biome | `npm install --save-dev @biomejs/biome` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Tests | `npx vitest run` | all pass |

## Scope

**In scope** (the only files you should create/modify):
- `tsconfig.json` (create)
- `biome.json` (create)
- `.github/workflows/ci.yml` (create)
- `package.json` (scripts + biome devDependency)

**Out of scope** (do NOT touch, even though they look related):
- `src/` behavior and `test/` assertions — you may fix **type errors and lint violations only**, nothing else.
- `README.md`, `plans/` files.
- Reformatting wholesale: `biome check` reports; fix what it reports (should be small). Do NOT run `biome check --write` (also known as `--apply`) across the repo — no mass reformat.

## Git workflow

- Branch: `advisor/004-ci-gates`
- Commit: `ci: add typecheck, lint, and CI workflow` (single commit)
- Do NOT push or open a PR.

## Steps

### Step 1: Add `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

**Verify**: `npx tsc --noEmit` runs. It will likely report errors — that is expected; do NOT stop, go to Step 2's fix loop.

### Step 2: Add `typecheck` script and fix type errors

1. Add `"typecheck": "tsc --noEmit"` to `package.json` scripts.
2. Fix every error `npm run typecheck` reports, but **only**: type errors in `src/` or `test/` (e.g. missing null checks, unused variables flagged under strict). If an error requires changing an exported API shape or a dependency, treat it as a STOP condition instead.
3. If errors reference files under `node_modules`, adjust `tsconfig.json` (`exclude: ["node_modules"]` is already implied by `include` — if they persist, report, don't hack around).

**Verify**: `npm run typecheck` → exit 0, no errors.

### Step 3: Add Biome and `lint` script

1. `npm install --save-dev @biomejs/biome`
2. Create `biome.json`:
```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": { "ignoreUnknown": true },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true }
  }
}
```
If your installed Biome version's schema URL differs, use the version you installed (check `node_modules/@biomejs/biome/package.json`).
3. Add `"lint": "biome check src test"` to scripts.
4. Run `npm run lint`. Fix every reported violation in `src/` and `test/` **by hand** (unused imports, `any`, etc. — typically a handful). Preserve behavior exactly. Prefer the smallest edit that satisfies the rule. If a violation can only be fixed by adding `// biome-ignore` with a truthful comment (matching the existing pattern at src/ask-user.ts:97), that is acceptable and matches repo convention — but prefer a real fix.
5. If Biome's formatter reports formatting differences on files you touch, align those files with `biome check` output by editing (or `biome check --write <specific-file>` for formatting only, never `--write` on everything).

**Verify**: `npm run lint` → exit 0, no output beyond success.

### Step 4: Add CI workflow

Create `.github/workflows/ci.yml`:
```yaml
name: CI
on:
  push:
    branches: [master]
  pull_request:
jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
```

**Verify**: file exists at `.github/workflows/ci.yml` (no command needed — check with `Test-Path`/`ls`).

### Step 5: Full gate

**Verify**: `npm run typecheck` exit 0 AND `npm run lint` exit 0 AND `npx vitest run` all pass.

## Test plan

- No behavior changes: the full existing suite must stay green (`npx vitest run`).
- The gates themselves are the deliverable; CI runs them on every push/PR.

## Done criteria

All must hold:

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npx vitest run` passes (no test modified)
- [ ] `tsconfig.json`, `biome.json`, `.github/workflows/ci.yml` exist
- [ ] `package.json` has `typecheck` + `lint` scripts and `@biomejs/biome` devDependency
- [ ] No behavioral change in `src/` or `test/` beyond type-error/lint fixes (state this explicitly in your report)

## STOP conditions

Stop and report back (do not improvise) if:

- Type errors require changing an exported API shape, editing node_modules, or adding dependencies.
- `npm run lint` surfaces more than ~15 distinct violations (something is misconfigured — report, don't mass-edit).
- Biome's formatter would reformat most of the repo (config drift — report).
- The GitHub workflow syntax is beyond your confidence (use the exact YAML above).

## Maintenance notes

- CI uses `npm ci` — the lockfile must stay in sync with package.json; `npm install` updates it.
- When the package grows tests, they land in `test/` and are picked up automatically.
- `typecheck` uses `skipLibCheck` — dependency type bugs are intentionally not our gate.