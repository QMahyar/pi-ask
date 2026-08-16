// Configurable tool prompt-surface overrides.
//
// Resolution order: package defaults ← global pi-ask config ← trusted project pi-ask config.
// Project overrides are trust-gated; they require PI project trust and a PI-recognized
// trust-requiring resource (e.g. .pi/settings.json).

import {
  type ExtensionContext,
  hasTrustRequiringProjectResources,
} from "@earendil-works/pi-coding-agent";
import {
  hasProjectConfig,
  loadPiAskConfigSectionForScope,
  type PiAskConfigOptions,
} from "./config.ts";

// ── Public types ───────────────────────────────────────────────────────────

/** Model-facing text that PI adds to one registered tool's prompt surface. */
export interface SuiPiToolPromptSurface {
  description: string;
  promptSnippet: string;
  promptGuidelines: string[];
}

export type ToolPromptSurfaceDiagnosticCode =
  | "invalidPromptSurfaceConfig"
  | "invalidPromptSurfaceField"
  | "projectPromptSurfaceIgnored";

export interface ToolPromptSurfaceDiagnostic {
  code: ToolPromptSurfaceDiagnosticCode;
  scope: "global" | "project";
  section: string;
  toolName: string;
  message: string;
}

export interface ResolveToolPromptSurfaceOptions extends PiAskConfigOptions {
  section: string;
  toolName: string;
  defaults: SuiPiToolPromptSurface;
  ctx: Pick<ExtensionContext, "cwd" | "isProjectTrusted">;
}

export interface ResolveToolPromptSurfaceResult {
  surface: SuiPiToolPromptSurface;
  diagnostics: ToolPromptSurfaceDiagnostic[];
}

// ── Private types ──────────────────────────────────────────────────────────

type PromptSurfaceField = keyof SuiPiToolPromptSurface;
type PromptSurfaceScope = ToolPromptSurfaceDiagnostic["scope"];

const PROMPT_SURFACE_FIELDS = new Set<string>(["description", "promptSnippet", "promptGuidelines"]);

const PROMPT_SURFACE_CONFIG_KEYS = new Set<string>([
  "description",
  "promptSnippet",
  "promptGuidelines",
  "prependPromptGuidelines",
  "appendPromptGuidelines",
  "$reset",
]);

const TOOL_ENTRY_KEYS = new Set<string>(["promptSurface"]);

const PROMPT_SURFACE_DIAGNOSTICS_KEY = Symbol.for(
  "pi-ask/core/tool-prompt-surface/notified-diagnostics",
);

// ── Resolution ─────────────────────────────────────────────────────────────

/** Resolve a tool's model-facing prompt surface from defaults + pi-ask config overrides. */
export function resolveToolPromptSurface(
  options: ResolveToolPromptSurfaceOptions,
): ResolveToolPromptSurfaceResult {
  const diagnostics: ToolPromptSurfaceDiagnostic[] = [];
  let surface = clonePromptSurface(options.defaults);

  const globalSection = loadPiAskConfigSectionForScope(options.section, options.ctx.cwd, {
    scope: "global",
    homeDir: options.homeDir,
  });
  surface = applyPromptSurfaceScope(surface, options, "global", globalSection, diagnostics);

  // The project config is read, parsed, and validated only when the project is
  // trusted — an untrusted project's config is never touched (no read, no parse,
  // no diagnostics beyond the refusal below).
  const hasTrustMarker = hasTrustRequiringProjectResources(options.ctx.cwd);
  const projectTrusted = options.ctx.isProjectTrusted();
  if (hasTrustMarker && projectTrusted) {
    const projectSection = loadPiAskConfigSectionForScope(options.section, options.ctx.cwd, {
      scope: "project",
      homeDir: options.homeDir,
    });
    const projectPromptSurface = getPromptSurfaceConfig(projectSection, options.toolName, {
      diagnostics,
      options,
      scope: "project",
    });
    if (projectPromptSurface) {
      // $reset at project scope restores fields to the state as resolved from global
      // scope (package defaults + global overrides), then the project's other
      // overrides apply on top.
      surface = applyPromptSurfaceConfig(
        surface,
        surface,
        projectPromptSurface,
        options,
        "project",
        diagnostics,
      );
    }
  } else if (hasProjectConfig(options.ctx.cwd)) {
    diagnostics.push({
      code: "projectPromptSurfaceIgnored",
      scope: "project",
      section: options.section,
      toolName: options.toolName,
      message: hasTrustMarker
        ? `Project prompt-surface overrides for ${options.toolName} were ignored because the project is not trusted in PI.`
        : `Project prompt-surface overrides for ${options.toolName} were ignored because ${options.ctx.cwd}/.pi/pi-ask/config.json is not PI trust-gated. Add .pi/settings.json and trust the project to enable them.`,
    });
  }

  return { surface, diagnostics };
}

/** Notify prompt-surface diagnostics once per session/tool/diagnostic code. */
export function notifyToolPromptSurfaceDiagnostics(
  ctx: Pick<ExtensionContext, "sessionManager" | "ui">,
  diagnostics: readonly ToolPromptSurfaceDiagnostic[],
): void {
  const globalRecord = globalThis as Record<
    symbol,
    { sessionId: string; notified: Set<string> } | undefined
  >;
  const sessionId = ctx.sessionManager.getSessionId();
  let state = globalRecord[PROMPT_SURFACE_DIAGNOSTICS_KEY];
  // Key the dedup set per session runtime so it cannot grow unboundedly: when a
  // new session starts, the previous session's set is replaced.
  if (!state || state.sessionId !== sessionId) {
    state = { sessionId, notified: new Set() };
    globalRecord[PROMPT_SURFACE_DIAGNOSTICS_KEY] = state;
  }

  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.section}:${diagnostic.toolName}:${diagnostic.code}`;
    if (state.notified.has(key)) continue;
    state.notified.add(key);
    ctx.ui.notify(diagnostic.message, "warning");
  }
}

// ── Scope helpers ──────────────────────────────────────────────────────────

function applyPromptSurfaceScope(
  current: SuiPiToolPromptSurface,
  options: ResolveToolPromptSurfaceOptions,
  scope: PromptSurfaceScope,
  sectionConfig: Record<string, unknown> | null,
  diagnostics: ToolPromptSurfaceDiagnostic[],
): SuiPiToolPromptSurface {
  const promptSurface = getPromptSurfaceConfig(sectionConfig, options.toolName, {
    diagnostics,
    options,
    scope,
  });
  if (!promptSurface) return current;
  return applyPromptSurfaceConfig(
    current,
    options.defaults,
    promptSurface,
    options,
    scope,
    diagnostics,
  );
}

function applyPromptSurfaceConfig(
  current: SuiPiToolPromptSurface,
  resetBase: SuiPiToolPromptSurface,
  config: Record<string, unknown>,
  options: ResolveToolPromptSurfaceOptions,
  scope: PromptSurfaceScope,
  diagnostics: ToolPromptSurfaceDiagnostic[],
): SuiPiToolPromptSurface {
  let next = clonePromptSurface(current);

  for (const field of getResetFields(config.$reset, options, scope, diagnostics)) {
    next = { ...next, [field]: clonePromptSurfaceField(resetBase[field]) };
  }

  const description = getOptionalNonEmptyString(
    config.description,
    "description",
    options,
    scope,
    diagnostics,
  );
  if (description !== undefined) next.description = description;

  const promptSnippet = getOptionalNonEmptyString(
    config.promptSnippet,
    "promptSnippet",
    options,
    scope,
    diagnostics,
  );
  if (promptSnippet !== undefined) next.promptSnippet = promptSnippet;

  const promptGuidelines = getOptionalStringArray(
    config.promptGuidelines,
    "promptGuidelines",
    options,
    scope,
    diagnostics,
  );
  if (promptGuidelines !== undefined) next.promptGuidelines = promptGuidelines;

  const prepend = getOptionalStringArray(
    config.prependPromptGuidelines,
    "prependPromptGuidelines",
    options,
    scope,
    diagnostics,
  );
  if (prepend !== undefined) next.promptGuidelines = [...prepend, ...next.promptGuidelines];

  const append = getOptionalStringArray(
    config.appendPromptGuidelines,
    "appendPromptGuidelines",
    options,
    scope,
    diagnostics,
  );
  if (append !== undefined) next.promptGuidelines = [...next.promptGuidelines, ...append];

  return next;
}

// ── Config extraction ──────────────────────────────────────────────────────

function getPromptSurfaceConfig(
  sectionConfig: Record<string, unknown> | null,
  toolName: string,
  deps: {
    diagnostics: ToolPromptSurfaceDiagnostic[];
    options: ResolveToolPromptSurfaceOptions;
    scope: PromptSurfaceScope;
  },
): Record<string, unknown> | null {
  if (!sectionConfig) return null;
  pushUnknownKeyDiagnostics(
    deps,
    deps.options.section,
    new Set<string>(["tools"]),
    Object.keys(sectionConfig),
  );
  if (sectionConfig.tools === undefined) return null;
  if (!isRecord(sectionConfig.tools)) {
    pushInvalidConfig(deps, "tools must be an object.");
    return null;
  }
  pushUnknownKeyDiagnostics(
    deps,
    `${deps.options.section}.tools`,
    new Set<string>([toolName]),
    Object.keys(sectionConfig.tools),
  );
  const toolConfig = sectionConfig.tools[toolName];
  if (toolConfig === undefined) return null;
  if (!isRecord(toolConfig)) {
    pushInvalidConfig(deps, `tools.${toolName} must be an object.`);
    return null;
  }
  pushUnknownKeyDiagnostics(
    deps,
    `${deps.options.section}.tools.${toolName}`,
    TOOL_ENTRY_KEYS,
    Object.keys(toolConfig),
  );
  if (toolConfig.promptSurface === undefined) return null;
  if (!isRecord(toolConfig.promptSurface)) {
    pushInvalidConfig(deps, `tools.${toolName}.promptSurface must be an object.`);
    return null;
  }
  for (const key of Object.keys(toolConfig.promptSurface)) {
    if (PROMPT_SURFACE_CONFIG_KEYS.has(key)) continue;
    pushInvalidField(
      deps.options,
      deps.scope,
      deps.diagnostics,
      key,
      `unknown field; expected one of: ${formatKnownKeys(PROMPT_SURFACE_CONFIG_KEYS)}.`,
    );
  }
  return toolConfig.promptSurface;
}

// ── Field validation ───────────────────────────────────────────────────────

function getResetFields(
  value: unknown,
  options: ResolveToolPromptSurfaceOptions,
  scope: PromptSurfaceScope,
  diagnostics: ToolPromptSurfaceDiagnostic[],
): PromptSurfaceField[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    pushInvalidField(options, scope, diagnostics, "$reset", "must be an array.");
    return [];
  }
  const fields: PromptSurfaceField[] = [];
  for (const item of value) {
    if (typeof item === "string" && PROMPT_SURFACE_FIELDS.has(item)) {
      fields.push(item as PromptSurfaceField);
    } else {
      pushInvalidField(
        options,
        scope,
        diagnostics,
        "$reset",
        `contains unsupported field ${JSON.stringify(item)}.`,
      );
    }
  }
  return fields;
}

function getOptionalNonEmptyString(
  value: unknown,
  field: string,
  options: ResolveToolPromptSurfaceOptions,
  scope: PromptSurfaceScope,
  diagnostics: ToolPromptSurfaceDiagnostic[],
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" && value.length > 0) return value;
  pushInvalidField(options, scope, diagnostics, field, "must be a non-empty string.");
  return undefined;
}

function getOptionalStringArray(
  value: unknown,
  field: string,
  options: ResolveToolPromptSurfaceOptions,
  scope: PromptSurfaceScope,
  diagnostics: ToolPromptSurfaceDiagnostic[],
): string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return [...value];
  }
  pushInvalidField(options, scope, diagnostics, field, "must be an array of strings.");
  return undefined;
}

// ── Diagnostics ────────────────────────────────────────────────────────────

function pushUnknownKeyDiagnostics(
  deps: {
    diagnostics: ToolPromptSurfaceDiagnostic[];
    options: ResolveToolPromptSurfaceOptions;
    scope: PromptSurfaceScope;
  },
  location: string,
  knownKeys: ReadonlySet<string>,
  keys: readonly string[],
): void {
  for (const key of keys) {
    if (knownKeys.has(key)) continue;
    pushInvalidConfig(
      deps,
      `Unknown key ${JSON.stringify(key)} in ${location}; expected one of: ${formatKnownKeys(knownKeys)}.`,
    );
  }
}

function formatKnownKeys(keys: ReadonlySet<string>): string {
  return [...keys].map((key) => JSON.stringify(key)).join(", ");
}

function pushInvalidConfig(
  deps: {
    diagnostics: ToolPromptSurfaceDiagnostic[];
    options: ResolveToolPromptSurfaceOptions;
    scope: PromptSurfaceScope;
  },
  detail: string,
): void {
  deps.diagnostics.push({
    code: "invalidPromptSurfaceConfig",
    scope: deps.scope,
    section: deps.options.section,
    toolName: deps.options.toolName,
    message: `Invalid prompt-surface config for ${deps.options.section}.${deps.options.toolName}: ${detail}`,
  });
}

function pushInvalidField(
  options: ResolveToolPromptSurfaceOptions,
  scope: PromptSurfaceScope,
  diagnostics: ToolPromptSurfaceDiagnostic[],
  field: string,
  detail: string,
): void {
  diagnostics.push({
    code: "invalidPromptSurfaceField",
    scope,
    section: options.section,
    toolName: options.toolName,
    message: `Invalid prompt-surface field ${field} for ${options.section}.${options.toolName}: ${detail}`,
  });
}

// ── Cloning ────────────────────────────────────────────────────────────────

function clonePromptSurface(surface: SuiPiToolPromptSurface): SuiPiToolPromptSurface {
  return {
    description: surface.description,
    promptSnippet: surface.promptSnippet,
    promptGuidelines: [...surface.promptGuidelines],
  };
}

function clonePromptSurfaceField<T extends string | string[]>(value: T): T {
  return (Array.isArray(value) ? [...value] : value) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
