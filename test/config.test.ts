import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { hasTrustRequiringProjectResources } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readJsonFile } from "../src/core/config/config.ts";
import {
  notifyToolPromptSurfaceDiagnostics,
  type ResolveToolPromptSurfaceOptions,
  resolveToolPromptSurface,
  type SuiPiToolPromptSurface,
  type ToolPromptSurfaceDiagnostic,
} from "../src/core/config/prompt-surface.ts";

const defaults: SuiPiToolPromptSurface = {
  description: "default description",
  promptSnippet: "default snippet",
  promptGuidelines: ["default guideline"],
};

let fixtureRoot: string;
let globalConfigFile: string;

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value));
}

function resolve(cwd: string, trusted: boolean, homeDir = fixtureRoot) {
  const options: ResolveToolPromptSurfaceOptions = {
    section: "ask-user",
    toolName: "ask_user",
    defaults,
    ctx: { cwd, isProjectTrusted: () => trusted },
    homeDir,
  };
  return resolveToolPromptSurface(options);
}

function findDiagnostic(
  diagnostics: ToolPromptSurfaceDiagnostic[],
  code: ToolPromptSurfaceDiagnostic["code"],
  contains: string,
): ToolPromptSurfaceDiagnostic | undefined {
  return diagnostics.find((d) => d.code === code && d.message.includes(contains));
}

beforeEach(() => {
  fixtureRoot = mkdtempSync(path.join(tmpdir(), "pi-ask-config-"));
  globalConfigFile = path.join(fixtureRoot, "pi-ask", "config.json");
});

afterEach(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("readJsonFile", () => {
  it("returns null silently for a missing file (ENOENT)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(readJsonFile(path.join(fixtureRoot, "does-not-exist.json"))).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns for non-ENOENT fs errors instead of failing silently", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const dir = path.join(fixtureRoot, "not-a-file");
    mkdirSync(dir);
    expect(readJsonFile(dir)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Failed to read config file"));
  });

  it("warns for invalid JSON and ignores the file", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mkdirSync(path.dirname(globalConfigFile), { recursive: true });
    writeFileSync(globalConfigFile, "{ not json");
    expect(readJsonFile(globalConfigFile)).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Failed to parse config file"));
  });

  it("returns the parsed object for a valid config file", () => {
    writeJson(globalConfigFile, { "ask-user": { tools: {} } });
    expect(readJsonFile(globalConfigFile)).toEqual({ "ask-user": { tools: {} } });
  });
});

describe("global config path", () => {
  it("honors PI_CODING_AGENT_DIR through getAgentDir", () => {
    const previous = process.env.PI_CODING_AGENT_DIR;
    try {
      process.env.PI_CODING_AGENT_DIR = fixtureRoot;
      writeJson(globalConfigFile, {
        "ask-user": { tools: { ask_user: { promptSurface: { description: "env description" } } } },
      });
      const { surface } = resolve(fixtureRoot, true, undefined);
      expect(surface.description).toBe("env description");
    } finally {
      if (previous === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previous;
      }
    }
  });

  it("uses the homeDir option as the agent dir base", () => {
    writeJson(globalConfigFile, {
      "ask-user": { tools: { ask_user: { promptSurface: { description: "home description" } } } },
    });
    const { surface } = resolve(fixtureRoot, true);
    expect(surface.description).toBe("home description");
  });
});

describe("scope precedence and ordering", () => {
  it("resolves defaults ← global ← trusted project", () => {
    writeJson(globalConfigFile, {
      "ask-user": {
        tools: {
          ask_user: {
            promptSurface: { description: "global description", promptSnippet: "global snippet" },
          },
        },
      },
    });
    const projectCwd = path.join(fixtureRoot, "project");
    writeJson(path.join(projectCwd, ".pi", "settings.json"), {});
    writeJson(path.join(projectCwd, ".pi", "pi-ask", "config.json"), {
      "ask-user": {
        tools: { ask_user: { promptSurface: { description: "project description" } } },
      },
    });
    const { surface } = resolve(projectCwd, true);
    expect(surface.description).toBe("project description");
    expect(surface.promptSnippet).toBe("global snippet");
    expect(surface.promptGuidelines).toEqual(["default guideline"]);
  });

  it("project $reset restores the field to its global-resolved state, not package defaults", () => {
    writeJson(globalConfigFile, {
      "ask-user": {
        tools: {
          ask_user: { promptSurface: { description: "global description" } },
        },
      },
    });
    const projectCwd = path.join(fixtureRoot, "project");
    writeJson(path.join(projectCwd, ".pi", "settings.json"), {});
    writeJson(path.join(projectCwd, ".pi", "pi-ask", "config.json"), {
      "ask-user": {
        tools: {
          ask_user: {
            promptSurface: {
              $reset: ["description"],
              promptGuidelines: ["project guideline"],
              appendPromptGuidelines: ["appended"],
            },
          },
        },
      },
    });
    const { surface } = resolve(projectCwd, true);
    expect(surface.description).toBe("global description");
    expect(surface.promptGuidelines).toEqual(["project guideline", "appended"]);
  });

  it("global $reset restores package defaults", () => {
    writeJson(globalConfigFile, {
      "ask-user": {
        tools: {
          ask_user: { promptSurface: { $reset: ["description"] } },
        },
      },
    });
    const { surface } = resolve(fixtureRoot, true);
    expect(surface.description).toBe("default description");
  });

  it("applies prepend/append at global then project scope in order", () => {
    writeJson(globalConfigFile, {
      "ask-user": {
        tools: {
          ask_user: {
            promptSurface: {
              prependPromptGuidelines: ["global-prepend"],
              appendPromptGuidelines: ["global-append"],
            },
          },
        },
      },
    });
    const projectCwd = path.join(fixtureRoot, "project");
    writeJson(path.join(projectCwd, ".pi", "settings.json"), {});
    writeJson(path.join(projectCwd, ".pi", "pi-ask", "config.json"), {
      "ask-user": {
        tools: {
          ask_user: {
            promptSurface: {
              prependPromptGuidelines: ["project-prepend"],
              appendPromptGuidelines: ["project-append"],
            },
          },
        },
      },
    });
    const { surface } = resolve(projectCwd, true);
    expect(surface.promptGuidelines).toEqual([
      "project-prepend",
      "global-prepend",
      "default guideline",
      "global-append",
      "project-append",
    ]);
  });
});

describe("trust gate", () => {
  it("applies the project config when the project is trust-gated and trusted", () => {
    const projectCwd = path.join(fixtureRoot, "project");
    writeJson(path.join(projectCwd, ".pi", "settings.json"), {});
    writeJson(path.join(projectCwd, ".pi", "pi-ask", "config.json"), {
      "ask-user": {
        tools: { ask_user: { promptSurface: { description: "trusted override" } } },
      },
    });
    const { surface, diagnostics } = resolve(projectCwd, true);
    expect(surface.description).toBe("trusted override");
    expect(diagnostics).toHaveLength(0);
  });

  it("refuses project overrides when the project is not trusted in PI", () => {
    const projectCwd = path.join(fixtureRoot, "project");
    writeJson(path.join(projectCwd, ".pi", "settings.json"), {});
    writeJson(path.join(projectCwd, ".pi", "pi-ask", "config.json"), {
      "ask-user": {
        tools: { ask_user: { promptSurface: { description: "untrusted override" } } },
      },
    });
    const { surface, diagnostics } = resolve(projectCwd, false);
    expect(surface.description).toBe("default description");
    const refusal = findDiagnostic(diagnostics, "projectPromptSurfaceIgnored", "not trusted in PI");
    expect(refusal).toBeDefined();
  });

  it("refuses a markerless project config and never parses it", () => {
    const projectCwd = path.join(fixtureRoot, "project");
    // Environment sanity: a markerless fixture must not sit under a trust-requiring
    // ancestor (e.g. a real ~/.pi/settings.json), or the trust gate would pass it.
    expect(hasTrustRequiringProjectResources(projectCwd)).toBe(false);
    mkdirSync(path.join(projectCwd, ".pi", "pi-ask"), { recursive: true });
    writeFileSync(path.join(projectCwd, ".pi", "pi-ask", "config.json"), "{ not json");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { surface, diagnostics } = resolve(projectCwd, false);
    expect(surface.description).toBe("default description");
    expect(warn).not.toHaveBeenCalled();
    const refusal = findDiagnostic(
      diagnostics,
      "projectPromptSurfaceIgnored",
      "not PI trust-gated",
    );
    expect(refusal).toBeDefined();
  });

  it("emits no project diagnostics when a markerless project has no config file", () => {
    const projectCwd = path.join(fixtureRoot, "project");
    mkdirSync(projectCwd, { recursive: true });
    const { surface, diagnostics } = resolve(projectCwd, false);
    expect(surface.description).toBe("default description");
    expect(diagnostics).toHaveLength(0);
  });
});

describe("unknown-key diagnostics", () => {
  it("flags unknown keys at every level", () => {
    writeJson(globalConfigFile, {
      "ask-user": {
        toolz: { wrong: true },
        tools: {
          ask_user: {
            $reset: ["description"],
            promptSurface: {
              description: "ok",
              descripiton: "typo'd field",
            },
          },
          other_tool: { promptSurface: { description: "other" } },
        },
      },
    });
    const { surface, diagnostics } = resolve(fixtureRoot, true);
    expect(surface.description).toBe("ok");
    expect(findDiagnostic(diagnostics, "invalidPromptSurfaceConfig", '"toolz"')).toBeDefined();
    expect(findDiagnostic(diagnostics, "invalidPromptSurfaceConfig", '"other_tool"')).toBeDefined();
    expect(findDiagnostic(diagnostics, "invalidPromptSurfaceConfig", '"$reset"')).toBeDefined();
    expect(findDiagnostic(diagnostics, "invalidPromptSurfaceField", "descripiton")).toBeDefined();
  });

  it("flags unknown keys in a trusted project config with project scope", () => {
    const projectCwd = path.join(fixtureRoot, "project");
    writeJson(path.join(projectCwd, ".pi", "settings.json"), {});
    writeJson(path.join(projectCwd, ".pi", "pi-ask", "config.json"), {
      "ask-user": {
        tools: { ask_user: { promptSurface: { bogus: 1 } } },
      },
    });
    const { diagnostics } = resolve(projectCwd, true);
    const flagged = findDiagnostic(diagnostics, "invalidPromptSurfaceField", "bogus");
    expect(flagged).toBeDefined();
    expect(flagged?.scope).toBe("project");
  });
});

describe("notifyToolPromptSurfaceDiagnostics", () => {
  it("dedups per session and resets for a new session", () => {
    const notify = vi.fn();
    const diagnostics: ToolPromptSurfaceDiagnostic[] = [
      {
        code: "invalidPromptSurfaceField",
        scope: "global",
        section: "ask-user",
        toolName: "ask_user",
        message: "bad field",
      },
    ];
    const ctxFor = (sessionId: string): Parameters<typeof notifyToolPromptSurfaceDiagnostics>[0] =>
      ({
        sessionManager: { getSessionId: () => sessionId },
        ui: { notify },
      }) as unknown as Parameters<typeof notifyToolPromptSurfaceDiagnostics>[0];
    notifyToolPromptSurfaceDiagnostics(ctxFor("session-a"), diagnostics);
    notifyToolPromptSurfaceDiagnostics(ctxFor("session-a"), diagnostics);
    expect(notify).toHaveBeenCalledTimes(1);
    notifyToolPromptSurfaceDiagnostics(ctxFor("session-b"), diagnostics);
    notifyToolPromptSurfaceDiagnostics(ctxFor("session-b"), diagnostics);
    expect(notify).toHaveBeenCalledTimes(2);
  });
});
