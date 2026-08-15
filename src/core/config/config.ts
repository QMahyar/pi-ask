// Shared config system for pi-ask.
//
// Global config: ~/.pi/agent/pi-ask/config.json
// Project config: .pi/pi-ask/config.json (relative to cwd)
// Resolution: hardcoded defaults ← global ← project

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

const GLOBAL_CONFIG_DIR = `${CONFIG_DIR_NAME}/agent/pi-ask`;
const PROJECT_CONFIG_DIR = `${CONFIG_DIR_NAME}/pi-ask`;
const CONFIG_FILE = "config.json";

function getGlobalConfigPath(homeDir?: string): string {
  return path.join(homeDir ?? os.homedir(), GLOBAL_CONFIG_DIR, CONFIG_FILE);
}

function getProjectConfigPath(cwd: string): string {
  return path.join(cwd, PROJECT_CONFIG_DIR, CONFIG_FILE);
}

export function readJsonFile(filePath: string): Record<string, unknown> | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    // ENOENT or permission error — silent, file may not exist
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
