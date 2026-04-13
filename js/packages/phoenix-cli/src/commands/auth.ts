import type { componentsV1 } from "@arizeai/phoenix-client";
import { getStrFromEnvironment } from "@arizeai/phoenix-config";
import { Command } from "commander";

import { createPhoenixClient } from "../client";
import {
  ENV_PHOENIX_PROFILE,
  type PhoenixConfig,
  resolveConfig,
} from "../config";
import { ExitCode, getExitCodeForError } from "../exitCodes";
import { writeError, writeOutput, writeProgress } from "../io";
import {
  type ProfilesFile,
  ProfileResolutionError,
  ProfilesFileError,
  getActiveProfile,
  loadProfiles,
  saveProfiles,
  validateProfileName,
} from "../profiles";
import {
  type OutputFormat,
  type ProfileListEntry,
  formatProfilesOutput,
} from "./formatProfiles";

type ViewerUser = componentsV1["schemas"]["GetViewerResponseBody"]["data"];

interface AuthStatusOptions {
  endpoint?: string;
  apiKey?: string;
  profile?: string;
}

/**
 * Obscure an API key for display using asterisks.
 * Shows a fixed number of asterisks regardless of key length for security.
 */
export function obscureApiKey(apiKey: string): string {
  if (!apiKey) {
    return "";
  }
  return "************************************";
}

interface FetchViewerSuccess {
  status: "success";
  user: ViewerUser;
}

interface FetchViewerError {
  status: "network_error" | "auth_error" | "not_found" | "unknown_error";
  message: string;
}

export type FetchViewerResult = FetchViewerSuccess | FetchViewerError;

/**
 * Extract an HTTP status code from the phoenix-client middleware error message.
 * The middleware throws errors like: "https://example.org/api/v1/user: 401 Unauthorized"
 */
function parseStatusCode(error: Error): number | null {
  const match = error.message.match(/:\s*(\d{3})\s/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Fetch the authenticated viewer from the Phoenix server.
 * Gracefully handles network errors, auth failures, and missing endpoints.
 */
async function fetchViewer(config: PhoenixConfig): Promise<FetchViewerResult> {
  try {
    const client = createPhoenixClient({ config });
    const response = await client.GET("/v1/user");
    return { status: "success", user: response.data!.data };
  } catch (error: unknown) {
    // TypeError is thrown by the Fetch API for network-level failures
    if (error instanceof TypeError) {
      return { status: "network_error", message: error.message };
    }
    if (error instanceof Error) {
      const statusCode = parseStatusCode(error);
      if (statusCode === 401 || statusCode === 403) {
        return { status: "auth_error", message: error.message };
      }
      if (statusCode === 404) {
        return { status: "not_found", message: error.message };
      }
      return { status: "unknown_error", message: error.message };
    }
    return { status: "unknown_error", message: String(error) };
  }
}

/**
 * Format auth status output in gh-style format.
 */
export function formatAuthStatus(
  endpoint: string,
  result: FetchViewerResult,
  apiKey?: string,
  profileName?: string
): string {
  const lines: string[] = [endpoint];

  if (profileName) {
    lines.push(`  - Profile: ${profileName}`);
  }

  if (result.status === "success") {
    const user = result.user;
    if (user.auth_method === "ANONYMOUS") {
      lines.push("  \u2713 Authentication not required (anonymous)");
    } else {
      lines.push(`  \u2713 Logged in as ${user.username} (api key)`);
      lines.push(`  - Role: ${user.role}`);
    }
  } else if (result.status === "auth_error") {
    lines.push("  \u2717 Authentication failed (invalid or expired token)");
  } else if (result.status === "not_found") {
    lines.push(
      "  - Could not verify token (server does not support user endpoint)"
    );
  } else {
    // network_error or unknown_error
    if (apiKey) {
      lines.push(
        "  \u2717 Token configured but could not verify (server unreachable)"
      );
    } else {
      lines.push("  \u2717 Could not connect to server");
    }
  }

  if (apiKey) {
    lines.push(`  - Token: ${obscureApiKey(apiKey)}`);
  }

  return lines.join("\n");
}

function exitCodeForResult(result: FetchViewerResult): ExitCode {
  switch (result.status) {
    case "success":
    // 404 means the server is an older version without /v1/user — the token
    // may still be valid, we just can't verify it. Not a failure.
    case "not_found":
      return ExitCode.SUCCESS;
    case "auth_error":
      return ExitCode.AUTH_REQUIRED;
    case "network_error":
      return ExitCode.NETWORK_ERROR;
    case "unknown_error":
      return ExitCode.FAILURE;
  }
}

/**
 * Auth status command handler
 */
async function authStatusHandler(options: AuthStatusOptions): Promise<void> {
  let config: PhoenixConfig;
  try {
    config = resolveConfig({
      cliOptions: {
        endpoint: options.endpoint,
        apiKey: options.apiKey,
      },
      profileName: options.profile,
    });
  } catch (err) {
    if (err instanceof ProfileResolutionError) {
      writeError({ message: err.message });
      process.exit(getExitCodeForError(err));
    }
    throw err;
  }

  if (!config.endpoint) {
    writeError({
      message: "Configuration Error:\n  - Phoenix endpoint not configured",
    });
    process.exit(ExitCode.INVALID_ARGUMENT);
  }

  // Resolve the active profile name for display purposes. Safe to call
  // after resolveConfig — any invalid explicit profile would have thrown.
  const profilesFile = loadProfiles();
  const envProfileName = getStrFromEnvironment(ENV_PHOENIX_PROFILE);
  const activeProfileName = getActiveProfile(
    profilesFile,
    options.profile ?? envProfileName
  )?.name;

  const result = await fetchViewer(config);
  const output = formatAuthStatus(
    config.endpoint,
    result,
    config.apiKey,
    activeProfileName
  );
  writeOutput({ message: output });

  const code = exitCodeForResult(result);
  if (code !== ExitCode.SUCCESS) {
    process.exit(code);
  }
}

/**
 * Create the auth status subcommand
 */
function createAuthStatusCommand(): Command {
  const command = new Command("status");

  command
    .description("Show current Phoenix authentication status")
    .option("--endpoint <url>", "Phoenix API endpoint")
    .option("--api-key <key>", "Phoenix API key for authentication")
    .option("--profile <name>", "Auth profile to use")
    .action(authStatusHandler);

  return command;
}

// ---------------------------------------------------------------------------
// Auth profiles commands
// ---------------------------------------------------------------------------

/**
 * Build a ProfileListEntry array from a ProfilesFile, marking the active profile.
 */
function buildProfileListEntries(file: ProfilesFile): ProfileListEntry[] {
  const envProfileName = getStrFromEnvironment(ENV_PHOENIX_PROFILE);
  const activeName = getActiveProfile(file, envProfileName)?.name;
  return Object.entries(file.profiles).map(([name, entry]) => ({
    name,
    endpoint: entry.endpoint,
    apiKey: entry.apiKey,
    project: entry.project,
    active: name === activeName,
  }));
}

interface ProfilesListOptions {
  format?: OutputFormat;
}

async function authProfilesListHandler(
  options: ProfilesListOptions
): Promise<void> {
  const file = loadProfiles();
  const entries = buildProfileListEntries(file);
  const output = formatProfilesOutput({
    profiles: entries,
    format: options.format,
  });
  writeOutput({ message: output });
}

function createAuthProfilesListCommand(): Command {
  const command = new Command("list");
  command
    .description("List all auth profiles")
    .option(
      "--format <format>",
      'Output format: pretty, json, or raw (default: "pretty")'
    )
    .action(authProfilesListHandler);
  return command;
}

interface ProfilesCreateOptions {
  endpoint: string;
  apiKey?: string;
  project?: string;
  setActive?: boolean;
  format?: OutputFormat;
}

/**
 * Return true if `value` parses as an absolute URL with a scheme (http, https, …).
 * The stricter check (vs. a regex) rejects things like bare hostnames while
 * accepting the full range of valid URLs the WHATWG parser understands.
 */
function isValidUrl(value: string): boolean {
  try {
    // eslint-disable-next-line no-new
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

async function authProfilesCreateHandler(
  name: string,
  options: ProfilesCreateOptions
): Promise<void> {
  if (!validateProfileName(name)) {
    writeError({
      message: `Invalid profile name "${name}". Names must contain only letters, numbers, hyphens, and underscores.`,
    });
    process.exit(ExitCode.INVALID_ARGUMENT);
  }

  if (!options.endpoint) {
    writeError({
      message:
        "Missing required option: --endpoint <url>\n" +
        "A profile must have an endpoint to connect to.",
    });
    process.exit(ExitCode.INVALID_ARGUMENT);
  }

  if (!isValidUrl(options.endpoint)) {
    writeError({
      message: `Invalid endpoint "${options.endpoint}". Must be an absolute URL (e.g. https://app.phoenix.arize.com).`,
    });
    process.exit(ExitCode.INVALID_ARGUMENT);
  }

  let file: ProfilesFile;
  try {
    file = loadProfiles({ strict: true });
  } catch (err) {
    if (err instanceof ProfilesFileError) {
      writeError({ message: `Error reading profiles file: ${err.message}` });
      process.exit(ExitCode.FAILURE);
    }
    throw err;
  }

  if (file.profiles[name] !== undefined) {
    writeError({
      message: `Profile "${name}" already exists. Delete it first or choose a different name.`,
    });
    process.exit(ExitCode.INVALID_ARGUMENT);
  }

  const newFile: ProfilesFile = {
    ...file,
    profiles: {
      ...file.profiles,
      [name]: {
        endpoint: options.endpoint,
        ...(options.apiKey ? { apiKey: options.apiKey } : {}),
        ...(options.project ? { project: options.project } : {}),
      },
    },
    activeProfile: options.setActive ? name : file.activeProfile,
  };

  saveProfiles(newFile);

  const entry: ProfileListEntry = {
    name,
    endpoint: options.endpoint,
    apiKey: options.apiKey,
    project: options.project,
    active: options.setActive === true,
  };
  const output = formatProfilesOutput({
    profiles: [entry],
    format: options.format,
  });
  writeOutput({ message: output });
}

function createAuthProfilesCreateCommand(): Command {
  const command = new Command("create");
  command
    .description("Create a new auth profile")
    .argument("<name>", "Profile name (alphanumeric, hyphens, underscores)")
    .requiredOption("--endpoint <url>", "Phoenix API endpoint")
    .option("--api-key <key>", "Phoenix API key for authentication")
    .option("--project <name>", "Default project name")
    .option("--set-active", "Set this profile as the active profile")
    .option(
      "--format <format>",
      'Output format: pretty, json, or raw (default: "pretty")'
    )
    .action(authProfilesCreateHandler);
  return command;
}

interface ProfilesDeleteOptions {
  format?: OutputFormat;
}

async function authProfilesDeleteHandler(
  name: string,
  options: ProfilesDeleteOptions
): Promise<void> {
  let file: ProfilesFile;
  try {
    file = loadProfiles({ strict: true });
  } catch (err) {
    if (err instanceof ProfilesFileError) {
      writeError({ message: `Error reading profiles file: ${err.message}` });
      process.exit(ExitCode.FAILURE);
    }
    throw err;
  }

  if (file.profiles[name] === undefined) {
    writeError({ message: `Profile "${name}" does not exist.` });
    process.exit(ExitCode.INVALID_ARGUMENT);
  }

  const deletedEntry = file.profiles[name];
  const envProfileName = getStrFromEnvironment(ENV_PHOENIX_PROFILE);
  // Effective-active factors in PHOENIX_PROFILE override so the output row is
  // marked active only when the deleted profile was actually in use.
  const wasActive = name === getActiveProfile(file, envProfileName)?.name;

  const updatedProfiles = { ...file.profiles };
  delete updatedProfiles[name];

  // Persistence cleanup: only clear storedactiveProfile when this profile was
  // the stored default — PHOENIX_PROFILE may still select a different profile.
  let newActiveProfile = file.activeProfile;
  if (file.activeProfile === name) {
    newActiveProfile = null;
    writeProgress({
      message: `Warning: "${name}" was the stored default profile and has been deleted. Run \`px auth switch <name>\` to set a new default.`,
    });
  }

  saveProfiles({
    ...file,
    profiles: updatedProfiles,
    activeProfile: newActiveProfile,
  });

  const entry: ProfileListEntry = {
    name,
    endpoint: deletedEntry.endpoint,
    apiKey: deletedEntry.apiKey,
    project: deletedEntry.project,
    active: wasActive,
  };
  const output = formatProfilesOutput({
    profiles: [entry],
    format: options.format,
  });
  writeOutput({ message: output });
}

function createAuthProfilesDeleteCommand(): Command {
  const command = new Command("delete");
  command
    .description("Delete an auth profile")
    .argument("<name>", "Profile name to delete")
    .option(
      "--format <format>",
      'Output format: pretty, json, or raw (default: "pretty")'
    )
    .action(authProfilesDeleteHandler);
  return command;
}

/**
 * Create the auth profiles command with list/create/delete subcommands
 */
export function createAuthProfilesCommand(): Command {
  const command = new Command("profile");
  command.description("Manage named auth profiles");
  command.addCommand(createAuthProfilesListCommand());
  command.addCommand(createAuthProfilesCreateCommand());
  command.addCommand(createAuthProfilesDeleteCommand());
  return command;
}

// ---------------------------------------------------------------------------
// Auth switch command
// ---------------------------------------------------------------------------

interface SwitchOptions {
  format?: OutputFormat;
}

async function authSwitchHandler(
  name: string,
  options: SwitchOptions
): Promise<void> {
  let file: ProfilesFile;
  try {
    file = loadProfiles({ strict: true });
  } catch (err) {
    if (err instanceof ProfilesFileError) {
      writeError({ message: `Error reading profiles file: ${err.message}` });
      process.exit(ExitCode.FAILURE);
    }
    throw err;
  }

  const entry = file.profiles[name];
  if (entry === undefined) {
    writeError({
      message: `Profile "${name}" does not exist. Run \`px auth profile list\` to see available profiles.`,
    });
    process.exit(ExitCode.INVALID_ARGUMENT);
  }

  saveProfiles({ ...file, activeProfile: name });

  const profileEntry: ProfileListEntry = {
    name,
    endpoint: entry.endpoint,
    apiKey: entry.apiKey,
    project: entry.project,
    active: true,
  };
  const output = formatProfilesOutput({
    profiles: [profileEntry],
    format: options.format,
  });
  writeOutput({ message: output });
}

/**
 * Create the auth switch command
 */
export function createAuthSwitchCommand(): Command {
  const command = new Command("switch");
  command
    .description("Switch the active auth profile")
    .argument("<name>", "Profile name to activate")
    .option(
      "--format <format>",
      'Output format: pretty, json, or raw (default: "pretty")'
    )
    .action(authSwitchHandler);
  return command;
}

/**
 * Create the auth command with subcommands
 */
export function createAuthCommand(): Command {
  const command = new Command("auth");

  command.description("Manage Phoenix authentication");

  // Add subcommands
  command.addCommand(createAuthStatusCommand());
  command.addCommand(createAuthProfilesCommand());
  command.addCommand(createAuthSwitchCommand());

  return command;
}
