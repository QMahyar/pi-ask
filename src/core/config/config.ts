// Shared config system for pi-ask.
//
// Global config: <agent dir>/pi-ask/config.json (agent dir per getAgentDir() —
// PI_CODING_AGENT_DIR, default ~/.pi/agent)
// Project config: .pi/pi-ask/config.json (relative to cwd)
// Resolution: hardcoded defaults ← global ← trusted project

import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

const AGENT_CONFIG_DIR = "pi-ask";
const PROJECT_CONFIG_DIR = `${CONFIG_DIR_NAME}/pi-ask`;
const CONFIG_FILE = "config.json";

function getGlobalConfigPath(homeDir?: string): string {
  return path.join(homeDir ?? getAgentDir(), AGENT_CONFIG_DIR, CONFIG_FILE);
}

function getProjectConfigPath(cwd: string): string {
  return path.join(cwd, PROJECT_CONFIG_DIR, CONFIG_FILE);
}

/** Whether the project has a pi-ask config file (existence only, no read/parse). */
export function hasProjectConfig(cwd: string): boolean {
  return fs.existsSync(getProjectConfigPath(cwd));
}

export function readJsonFile(filePath: string): Record<string, unknown> | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch (error) {
    if (isMissingFileError(error)) {
      // Only a missing file is normal (optional config); anything else
      // (EACCES, EISDIR, ...) is a real problem worth a warning.
      return null;
    }
    console.warn(
      `[pi-ask-core] Failed to read config file (${getErrorCode(error)}), ignoring: ${filePath}`,
    );
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    console.warn(`[pi-ask-core] Failed to parse config file, ignoring: ${filePath}`);
    return null;
  }

  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }

  console.warn(`[pi-ask-core] Config file root is not an object, ignoring: ${filePath}`);
  return null;
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function getErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== undefined) return code;
  }
  return "unknown error";
}

export interface PiAskConfigOptions {
  homeDir?: string;
}

/**
 * Load the raw object for one config section and one scope.
 */
export function loadPiAskConfigSectionForScope(
  section: string,
  cwd: string,
  options: { scope: "global" | "project" } & PiAskConfigOptions,
): Record<string, unknown> | null {
  const configPath =
    options.scope === "global" ? getGlobalConfigPath(options.homeDir) : getProjectConfigPath(cwd);
  const config = readJsonFile(configPath);
  return extractSection(config, section);
}

function extractSection(
  config: Record<string, unknown> | null,
  section: string,
): Record<string, unknown> | null {
  if (!config) return null;
  const data = config[section];
  if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return null;
}
