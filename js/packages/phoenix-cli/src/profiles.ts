/**
 * Profile storage types, pure functions, and file I/O for the Phoenix CLI.
 *
 * Pure functions (parseProfilesFile, validateProfileName, getActiveProfile,
 * getProfile) have no file system dependencies and are fully unit-testable.
 * I/O functions (getConfigDir, getProfilesPath, loadProfiles, saveProfiles)
 * are grouped at the bottom of this module.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { z } from "zod";

import { InvalidArgumentError } from "./exitCodes";

const ProfileEntrySchema = z.object({
  endpoint: z.string().optional(),
  apiKey: z.string().optional(),
  project: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

const ProfilesFileSchema = z.object({
  version: z.literal(1),
  activeProfile: z.union([z.string(), z.null()]),
  profiles: z.record(z.string(), ProfileEntrySchema),
});

/**
 * A single named profile entry. All fields are optional — a profile may
 * override only a subset of configuration values.
 */
export type ProfileEntry = z.infer<typeof ProfileEntrySchema>;

/**
 * On-disk schema for the profiles config file.
 */
export type ProfilesFile = z.infer<typeof ProfilesFileSchema>;

/**
 * Result type returned by `parseProfilesFile`. Using a discriminated union
 * keeps parse errors explicit and avoids exceptions in the caller.
 */
export type ProfilesParseResult =
  | { ok: true; data: ProfilesFile }
  | { ok: false; reason: string };

/**
 * Typed error thrown by `loadProfiles({ strict: true })` when the profiles
 * file is malformed or has an unsupported schema version.
 */
export class ProfilesFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfilesFileError";
  }
}

/**
 * Typed error thrown when an explicitly requested profile (via `--profile`
 * or `PHOENIX_PROFILE`) does not resolve to an existing entry. Extends
 * `InvalidArgumentError` so `getExitCodeForError` maps it to
 * `ExitCode.INVALID_ARGUMENT` automatically.
 */
export class ProfileResolutionError extends InvalidArgumentError {
  constructor(message: string) {
    super(message);
    this.name = "ProfileResolutionError";
  }
}

/**
 * Empty profiles state. Used as the initial value and as the fallback in
 * forgiving mode when the file is missing or corrupt.
 */
export const DEFAULT_PROFILES_FILE: ProfilesFile = {
  version: 1,
  activeProfile: null,
  profiles: {},
};

/**
 * Format a Zod error path segment for human-readable messages.
 */
function formatZodPath(path: (string | number)[]): string {
  return path
    .map((segment, i) => {
      if (typeof segment === "number") {
        return `[${segment}]`;
      }
      return i === 0 ? segment : `.${segment}`;
    })
    .join("");
}

/**
 * Parse and validate a raw JSON string as a ProfilesFile.
 *
 * Returns `{ ok: false, reason }` rather than throwing on any parse failure
 * so callers can decide whether to warn+continue or throw a typed error.
 */
export function parseProfilesFile(rawJson: string): ProfilesParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { ok: false, reason: "Invalid JSON in profiles file" };
  }

  // Check for unsupported version before full schema validation so we can
  // produce a specific actionable message.
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    if (obj.version !== 1) {
      return {
        ok: false,
        reason: `Unsupported profiles version ${obj.version}, expected 1. Run \`px self update\` to update.`,
      };
    }
  }

  const result = ProfilesFileSchema.safeParse(parsed);
  if (result.success) {
    return { ok: true, data: result.data };
  }

  // Format the first Zod error into a human-readable message that matches
  // the path-based patterns expected by callers (e.g. `"prod".endpoint`).
  const issue = result.error.issues[0];
  const path = issue.path as (string | number)[];

  // Root-level shape errors (non-object, array, null)
  if (path.length === 0) {
    return { ok: false, reason: "Profiles file root must be an object" };
  }

  // profiles.<name> — entry is not an object
  if (path.length === 2 && path[0] === "profiles") {
    const name = path[1];
    return { ok: false, reason: `Profile "${name}" must be an object` };
  }

  // profiles.<name>.<field> — field has wrong type
  if (path.length === 3 && path[0] === "profiles") {
    const name = path[1];
    const field = path[2];
    if (field === "headers") {
      return {
        ok: false,
        reason: `Profile "${name}".headers must be an object`,
      };
    }
    return {
      ok: false,
      reason: `Profile "${name}".${field} must be a string`,
    };
  }

  // profiles.<name>.headers.<key> — header value has wrong type
  if (path.length === 4 && path[0] === "profiles" && path[2] === "headers") {
    const name = path[1];
    const key = path[3];
    return {
      ok: false,
      reason: `Profile "${name}".headers["${key}"] must be a string`,
    };
  }

  // activeProfile wrong type
  if (path[0] === "activeProfile") {
    return {
      ok: false,
      reason: "Profiles file 'activeProfile' must be a string or null",
    };
  }

  // profiles field wrong type (array, non-object)
  if (path[0] === "profiles") {
    return { ok: false, reason: "Profiles file 'profiles' must be an object" };
  }

  // Fallback: format path generically
  return {
    ok: false,
    reason: `Invalid profiles file at ${formatZodPath(path)}: ${issue.message}`,
  };
}

/**
 * Return true if the profile name contains only alphanumeric characters,
 * hyphens, or underscores. Empty strings and names with whitespace or other
 * special characters are rejected.
 */
export function validateProfileName(name: string): boolean {
  if (!name || name.trim() !== name) {
    return false;
  }
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

/**
 * Look up the active profile entry given a parsed profiles file and an
 * optional profile name override.
 *
 * Resolution order:
 *   1. `overrideName` (from --profile flag or PHOENIX_PROFILE) if provided and found
 *   2. `file.activeProfile` if set and found
 *   3. `undefined` if no active profile resolves to an existing entry
 *
 * Returns `undefined` (rather than throwing) when the referenced name does
 * not exist in the profiles record — callers fall through to env vars / defaults.
 *
 * Returns both the name and entry together so callers never need to re-resolve
 * the name separately.
 */
export function getActiveProfile(
  file: ProfilesFile,
  overrideName?: string
): { name: string; entry: ProfileEntry } | undefined {
  if (overrideName !== undefined) {
    const entry = file.profiles[overrideName];
    return entry !== undefined ? { name: overrideName, entry } : undefined;
  }
  if (file.activeProfile !== null) {
    const entry = file.profiles[file.activeProfile];
    return entry !== undefined
      ? { name: file.activeProfile, entry }
      : undefined;
  }
  return undefined;
}

/**
 * Look up a profile by name. Returns `undefined` if not found.
 */
export function getProfile(
  file: ProfilesFile,
  name: string
): ProfileEntry | undefined {
  return file.profiles[name];
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

/**
 * Return the Phoenix config directory. Respects `XDG_CONFIG_HOME` if set
 * (returns `$XDG_CONFIG_HOME/px`), otherwise falls back to `~/.px`.
 */
export function getConfigDir(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  if (xdgConfigHome) {
    return path.join(xdgConfigHome, "px");
  }
  return path.join(os.homedir(), ".px");
}

/**
 * Return the absolute path to the profiles config file.
 */
export function getProfilesPath(): string {
  return path.join(getConfigDir(), "profiles.json");
}

export interface LoadProfilesOptions {
  /** When true, malformed JSON or unknown schema versions throw ProfilesFileError. */
  strict?: boolean;
  /** Override the profiles file path (used in tests). Defaults to getProfilesPath(). */
  profilesPath?: string;
}

/**
 * Load the profiles file from disk.
 *
 * - Missing file: always returns `DEFAULT_PROFILES_FILE` (not an error — no profiles exist yet).
 * - Malformed JSON / unknown version, forgiving mode (default): returns `DEFAULT_PROFILES_FILE`
 *   and writes a warning to stderr.
 * - Malformed JSON / unknown version, strict mode: throws `ProfilesFileError`.
 */
export function loadProfiles(options?: LoadProfilesOptions): ProfilesFile {
  const strict = options?.strict ?? false;
  const filePath = options?.profilesPath ?? getProfilesPath();

  let rawJson: string;
  try {
    rawJson = fs.readFileSync(filePath, "utf-8");
  } catch (err: unknown) {
    // ENOENT — file doesn't exist yet; treat as empty state regardless of mode.
    if (
      typeof err === "object" &&
      err !== null &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return { ...DEFAULT_PROFILES_FILE, profiles: {} };
    }
    // In strict mode propagate unexpected OS errors (e.g. EACCES).
    if (strict) {
      throw err;
    }
    process.stderr.write(
      `Warning: Could not read profiles file (${filePath}): ${String(err)}\n`
    );
    return { ...DEFAULT_PROFILES_FILE, profiles: {} };
  }

  const result = parseProfilesFile(rawJson);
  if (result.ok) {
    return result.data;
  }

  if (strict) {
    throw new ProfilesFileError(result.reason);
  }

  process.stderr.write(`Warning: ${result.reason}\n`);
  return { ...DEFAULT_PROFILES_FILE, profiles: {} };
}

export interface SaveProfilesOptions {
  /** Override the profiles file path (used in tests). Defaults to getProfilesPath(). */
  profilesPath?: string;
}

/**
 * Persist the profiles file to disk.
 *
 * Creates the parent directory (and any ancestors) if it does not exist.
 * Writes human-readable JSON with 2-space indentation.
 */
export function saveProfiles(
  data: ProfilesFile,
  options?: SaveProfilesOptions
): void {
  const filePath = options?.profilesPath ?? getProfilesPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });
}
