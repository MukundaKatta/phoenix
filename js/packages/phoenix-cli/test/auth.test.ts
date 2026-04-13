import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CommanderError } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAuthCommand,
  type FetchViewerResult,
  formatAuthStatus,
  obscureApiKey,
} from "../src/commands/auth";
import { type ProfilesFile, saveProfiles } from "../src/profiles";

describe("Auth Commands", () => {
  describe("obscureApiKey", () => {
    it("should return asterisks for any API key", () => {
      const apiKey =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIxMjM0NTY3ODkwIn0.abc123";
      const obscured = obscureApiKey(apiKey);

      expect(obscured).toBe("************************************");
    });

    it("should return asterisks for short keys", () => {
      const shortKey = "abc";
      const obscured = obscureApiKey(shortKey);

      expect(obscured).toBe("************************************");
    });

    it("should handle empty string", () => {
      const emptyKey = "";
      const obscured = obscureApiKey(emptyKey);

      expect(obscured).toBe("");
    });

    it("should return fixed length asterisks regardless of input length", () => {
      const key1 = "short";
      const key2 = "a-very-long-api-key-that-is-much-longer-than-the-mask";

      expect(obscureApiKey(key1)).toBe(obscureApiKey(key2));
      expect(obscureApiKey(key1)).toBe("************************************");
    });
  });

  describe("Auth Status", () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      // Save original environment
      originalEnv = { ...process.env };

      // Clear environment variables
      delete process.env.PHOENIX_HOST;
      delete process.env.PHOENIX_API_KEY;
    });

    afterEach(() => {
      // Restore original environment
      process.env = originalEnv;
    });

    it("should detect when endpoint is configured from environment", async () => {
      process.env.PHOENIX_HOST = "http://localhost:6006";

      // Import after setting env vars
      const { resolveConfig } = await import("../src/config");

      const config = resolveConfig({ cliOptions: {} });

      expect(config.endpoint).toBe("http://localhost:6006");
    });

    it("should detect when API key is configured from environment", async () => {
      process.env.PHOENIX_HOST = "http://localhost:6006";
      process.env.PHOENIX_API_KEY = "test-api-key";

      // Import after setting env vars
      const { resolveConfig } = await import("../src/config");

      const config = resolveConfig({ cliOptions: {} });

      expect(config.endpoint).toBe("http://localhost:6006");
      expect(config.apiKey).toBe("test-api-key");
    });

    it("should prioritize CLI options over environment", async () => {
      process.env.PHOENIX_HOST = "http://env-host:6006";
      process.env.PHOENIX_API_KEY = "env-api-key";

      // Import after setting env vars
      const { resolveConfig } = await import("../src/config");

      const config = resolveConfig({
        cliOptions: {
          endpoint: "http://cli-host:6006",
          apiKey: "cli-api-key",
        },
      });

      expect(config.endpoint).toBe("http://cli-host:6006");
      expect(config.apiKey).toBe("cli-api-key");
    });

    it("should handle missing endpoint", async () => {
      // No PHOENIX_HOST set

      const { resolveConfig } = await import("../src/config");

      const config = resolveConfig({ cliOptions: {} });

      expect(config.endpoint).toBe("http://localhost:6006");
    });

    it("should handle missing API key (anonymous access)", async () => {
      process.env.PHOENIX_HOST = "http://localhost:6006";
      // No PHOENIX_API_KEY set

      const { resolveConfig } = await import("../src/config");

      const config = resolveConfig({ cliOptions: {} });

      expect(config.endpoint).toBe("http://localhost:6006");
      expect(config.apiKey).toBeUndefined();
    });
  });

  describe("formatAuthStatus", () => {
    const endpoint = "http://localhost:6006";
    const apiKey = "test-api-key";

    it("should format authenticated LOCAL user", () => {
      const result: FetchViewerResult = {
        status: "success",
        user: {
          auth_method: "LOCAL",
          username: "mikeldking",
          email: "mike@example.com",
          role: "ADMIN",
          id: "VXNlcjox",
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-01T00:00:00Z",
          password_needs_reset: false,
        },
      };

      const output = formatAuthStatus(endpoint, result, apiKey);

      expect(output).toContain(endpoint);
      expect(output).toContain("✓ Logged in as mikeldking (api key)");
      expect(output).not.toContain("Auth method");
      expect(output).toContain("Role: ADMIN");
      expect(output).toContain("Token: ****");
    });

    it("should format authenticated OAUTH2 user", () => {
      const result: FetchViewerResult = {
        status: "success",
        user: {
          auth_method: "OAUTH2",
          username: "oauthuser",
          email: "oauth@example.com",
          role: "MEMBER",
          id: "VXNlcjoy",
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-01T00:00:00Z",
        },
      };

      const output = formatAuthStatus(endpoint, result, apiKey);

      expect(output).toContain("✓ Logged in as oauthuser (api key)");
      expect(output).toContain("Role: MEMBER");
    });

    it("should format authenticated LDAP user", () => {
      const result: FetchViewerResult = {
        status: "success",
        user: {
          auth_method: "LDAP",
          username: "ldapuser",
          email: "ldap@example.com",
          role: "VIEWER",
          id: "VXNlcjoz",
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-01T00:00:00Z",
        },
      };

      const output = formatAuthStatus(endpoint, result, apiKey);

      expect(output).toContain("✓ Logged in as ldapuser (api key)");
      expect(output).toContain("Role: VIEWER");
    });

    it("should format anonymous user without token", () => {
      const result: FetchViewerResult = {
        status: "success",
        user: {
          auth_method: "ANONYMOUS",
        },
      };

      const output = formatAuthStatus(endpoint, result);

      expect(output).toContain("✓ Authentication not required (anonymous)");
      expect(output).not.toContain("Token:");
    });

    it("should format anonymous user with token configured", () => {
      const result: FetchViewerResult = {
        status: "success",
        user: {
          auth_method: "ANONYMOUS",
        },
      };

      const output = formatAuthStatus(endpoint, result, apiKey);

      expect(output).toContain("✓ Authentication not required (anonymous)");
      expect(output).toContain("Token: ****");
    });

    it("should format auth error with token", () => {
      const result: FetchViewerResult = {
        status: "auth_error",
        message: "401 Unauthorized",
      };

      const output = formatAuthStatus(endpoint, result, apiKey);

      expect(output).toContain(
        "✗ Authentication failed (invalid or expired token)"
      );
      expect(output).toContain("Token: ****");
    });

    it("should format network error with token", () => {
      const result: FetchViewerResult = {
        status: "network_error",
        message: "fetch failed",
      };

      const output = formatAuthStatus(endpoint, result, apiKey);

      expect(output).toContain(
        "✗ Token configured but could not verify (server unreachable)"
      );
      expect(output).toContain("Token: ****");
    });

    it("should format network error without token", () => {
      const result: FetchViewerResult = {
        status: "network_error",
        message: "fetch failed",
      };

      const output = formatAuthStatus(endpoint, result);

      expect(output).toContain("✗ Could not connect to server");
      expect(output).not.toContain("Token:");
    });

    it("should format not_found (older server)", () => {
      const result: FetchViewerResult = {
        status: "not_found",
        message: "404 Not Found",
      };

      const output = formatAuthStatus(endpoint, result, apiKey);

      expect(output).toContain(
        "Could not verify token (server does not support user endpoint)"
      );
      expect(output).toContain("Token: ****");
    });

    it("should show endpoint as first line", () => {
      const result: FetchViewerResult = {
        status: "success",
        user: { auth_method: "ANONYMOUS" },
      };

      const output = formatAuthStatus(endpoint, result);
      const lines = output.split("\n");

      expect(lines[0]).toBe(endpoint);
    });

    it("should include profile name line when profileName is provided", () => {
      const result: FetchViewerResult = {
        status: "success",
        user: { auth_method: "ANONYMOUS" },
      };

      const output = formatAuthStatus(endpoint, result, undefined, "prod");

      expect(output).toContain("Profile: prod");
    });

    it("should not include profile line when profileName is omitted", () => {
      const result: FetchViewerResult = {
        status: "success",
        user: { auth_method: "ANONYMOUS" },
      };

      const output = formatAuthStatus(endpoint, result);

      expect(output).not.toContain("Profile:");
    });
  });
});

// ---------------------------------------------------------------------------
// Auth profiles command integration tests
// ---------------------------------------------------------------------------

/**
 * Helper: write a profiles file into the temp XDG_CONFIG_HOME directory so
 * that command handlers pick it up without touching ~/.px.
 */
function writeTempProfiles(tmpDir: string, data: ProfilesFile): void {
  const pxDir = path.join(tmpDir, "px");
  fs.mkdirSync(pxDir, { recursive: true });
  saveProfiles(data, { profilesPath: path.join(pxDir, "profiles.json") });
}

/**
 * Parse a command string against `px auth …` and return captured stdout lines.
 * Mocks console.log/console.error and process.exit so tests stay isolated.
 */
async function runAuthCommand(
  args: string[],
  mocks: {
    logSpy: ReturnType<typeof vi.spyOn>;
    errorSpy: ReturnType<typeof vi.spyOn>;
    exitSpy: ReturnType<typeof vi.spyOn>;
  }
): Promise<void> {
  mocks.logSpy.mockClear();
  mocks.errorSpy.mockClear();
  mocks.exitSpy.mockClear();

  const cmd = createAuthCommand();
  // Commander exits on --help/version/parse errors; override so those don't
  // terminate the process. We re-throw anything that isn't a CommanderError
  // so that process.exit mock throws (from error-path handlers) propagate to
  // the test and can be asserted on with .rejects.toThrow().
  cmd.exitOverride();
  try {
    await cmd.parseAsync(["node", "px", ...args]);
  } catch (err) {
    if (err instanceof CommanderError) {
      // Commander parse/help errors — swallow, caller inspects spies.
      return;
    }
    // process.exit mock throws an Error — re-throw so callers using
    // .rejects.toThrow() see a rejection.
    throw err;
  }
}

describe("auth profiles command integration", () => {
  let tmpDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.PHOENIX_HOST;
    delete process.env.PHOENIX_API_KEY;
    delete process.env.PHOENIX_PROFILE;

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-auth-int-"));
    process.env.XDG_CONFIG_HOME = tmpDir;

    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((_code?: number | string) => {
        throw new Error(`process.exit(${_code})`);
      });
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // --- auth profiles list ---

  it("list outputs 'No profiles found' when no profiles exist", async () => {
    await runAuthCommand(["profile", "list"], { logSpy, errorSpy, exitSpy });

    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("No profiles found");
  });

  it("list shows existing profiles in pretty format by default", async () => {
    writeTempProfiles(tmpDir, {
      version: 1,
      activeProfile: "dev",
      profiles: {
        dev: { endpoint: "http://localhost:6006", apiKey: "dev-key" },
        prod: { endpoint: "https://prod.example.com" },
      },
    });

    await runAuthCommand(["profile", "list"], { logSpy, errorSpy, exitSpy });

    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("dev");
    expect(output).toContain("prod");
    expect(output).toContain("http://localhost:6006");
    expect(output).toContain("https://prod.example.com");
  });

  it("list marks the active profile with an asterisk in pretty format", async () => {
    writeTempProfiles(tmpDir, {
      version: 1,
      activeProfile: "dev",
      profiles: {
        dev: { endpoint: "http://localhost:6006" },
        prod: { endpoint: "https://prod.example.com" },
      },
    });

    await runAuthCommand(["profile", "list"], { logSpy, errorSpy, exitSpy });

    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("*");
  });

  it("list --format json outputs valid JSON with profiles array and masked keys", async () => {
    writeTempProfiles(tmpDir, {
      version: 1,
      activeProfile: "dev",
      profiles: {
        dev: { endpoint: "http://localhost:6006", apiKey: "secret-key" },
      },
    });

    await runAuthCommand(["profile", "list", "--format", "json"], {
      logSpy,
      errorSpy,
      exitSpy,
    });

    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("profiles");
    expect(Array.isArray(parsed.profiles)).toBe(true);
    expect(parsed.profiles[0].name).toBe("dev");
    expect(parsed.profiles[0].apiKey).not.toBe("secret-key");
    expect(parsed.profiles[0].apiKey).toContain("*");
  });

  it("list --format json never outputs plaintext API keys (always masked)", async () => {
    writeTempProfiles(tmpDir, {
      version: 1,
      activeProfile: null,
      profiles: {
        dev: { endpoint: "http://localhost:6006", apiKey: "secret-key" },
      },
    });

    await runAuthCommand(["profile", "list", "--format", "json"], {
      logSpy,
      errorSpy,
      exitSpy,
    });

    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    const parsed = JSON.parse(output);
    expect(parsed.profiles[0].apiKey).not.toBe("secret-key");
    expect(parsed.profiles[0].apiKey).toContain("*");
  });

  it("list rejects removed --show-secrets flag", async () => {
    writeTempProfiles(tmpDir, {
      version: 1,
      activeProfile: null,
      profiles: {
        dev: { endpoint: "http://localhost:6006", apiKey: "secret-key" },
      },
    });

    // Commander treats unknown options as parse errors. The process.exit
    // mock throws, surfacing as a rejection. The key guarantee is that the
    // plaintext key never appears in stdout.
    await expect(
      runAuthCommand(["profile", "list", "--show-secrets"], {
        logSpy,
        errorSpy,
        exitSpy,
      })
    ).rejects.toThrow();

    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).not.toContain("secret-key");
  });

  it("list --format raw outputs one JSON object per line", async () => {
    writeTempProfiles(tmpDir, {
      version: 1,
      activeProfile: null,
      profiles: {
        dev: { endpoint: "http://localhost:6006" },
        prod: { endpoint: "https://prod.example.com" },
      },
    });

    await runAuthCommand(["profile", "list", "--format", "raw"], {
      logSpy,
      errorSpy,
      exitSpy,
    });

    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    const lines = output.trim().split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("list masks api keys in pretty output (never shows raw key)", async () => {
    writeTempProfiles(tmpDir, {
      version: 1,
      activeProfile: null,
      profiles: {
        dev: { endpoint: "http://localhost:6006", apiKey: "super-secret-key" },
      },
    });

    await runAuthCommand(["profile", "list"], { logSpy, errorSpy, exitSpy });

    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).not.toContain("super-secret-key");
    expect(output).toContain("****");
  });

  // --- auth profiles create ---

  it("create adds a new profile and writes it to disk", async () => {
    await runAuthCommand(
      [
        "profile",
        "create",
        "staging",
        "--endpoint",
        "https://staging.example.com",
      ],
      { logSpy, errorSpy, exitSpy }
    );

    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("staging");
    expect(output).toContain("https://staging.example.com");

    // Verify the file was actually written
    const profilesPath = path.join(tmpDir, "px", "profiles.json");
    const data: ProfilesFile = JSON.parse(
      fs.readFileSync(profilesPath, "utf-8")
    );
    expect(data.profiles.staging).toBeDefined();
    expect(data.profiles.staging.endpoint).toBe("https://staging.example.com");
  });

  it("create with --set-default sets the profile as active", async () => {
    await runAuthCommand(
      [
        "profile",
        "create",
        "prod",
        "--endpoint",
        "https://prod.example.com",
        "--set-active",
      ],
      { logSpy, errorSpy, exitSpy }
    );

    const profilesPath = path.join(tmpDir, "px", "profiles.json");
    const data: ProfilesFile = JSON.parse(
      fs.readFileSync(profilesPath, "utf-8")
    );
    expect(data.activeProfile).toBe("prod");

    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("prod");
    expect(output).toContain("https://prod.example.com");
  });

  it("create with --api-key stores the key in the profile", async () => {
    await runAuthCommand(
      [
        "profile",
        "create",
        "dev",
        "--endpoint",
        "http://localhost:6006",
        "--api-key",
        "my-api-key",
      ],
      { logSpy, errorSpy, exitSpy }
    );

    const profilesPath = path.join(tmpDir, "px", "profiles.json");
    const data: ProfilesFile = JSON.parse(
      fs.readFileSync(profilesPath, "utf-8")
    );
    expect(data.profiles.dev.apiKey).toBe("my-api-key");
  });

  it("create with --project stores the project field", async () => {
    await runAuthCommand(
      [
        "profile",
        "create",
        "dev",
        "--endpoint",
        "http://localhost:6006",
        "--project",
        "my-project",
      ],
      { logSpy, errorSpy, exitSpy }
    );

    const profilesPath = path.join(tmpDir, "px", "profiles.json");
    const data: ProfilesFile = JSON.parse(
      fs.readFileSync(profilesPath, "utf-8")
    );
    expect(data.profiles.dev.project).toBe("my-project");
  });

  it("create exits with error for non-URL endpoint", async () => {
    await expect(
      runAuthCommand(
        ["profile", "create", "staging", "--endpoint", "not-a-url"],
        { logSpy, errorSpy, exitSpy }
      )
    ).rejects.toThrow();

    const errOutput = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(errOutput).toMatch(/Invalid endpoint/i);
    expect(errOutput).toContain("not-a-url");
  });

  it("create exits with error for invalid profile name", async () => {
    await expect(
      runAuthCommand(
        [
          "profile",
          "create",
          "my profile!",
          "--endpoint",
          "http://localhost:6006",
        ],
        { logSpy, errorSpy, exitSpy }
      )
    ).rejects.toThrow();

    const errOutput = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(errOutput).toContain("Invalid profile name");
  });

  it("create exits with error when profile already exists", async () => {
    writeTempProfiles(tmpDir, {
      version: 1,
      activeProfile: null,
      profiles: { dev: { endpoint: "http://localhost:6006" } },
    });

    await expect(
      runAuthCommand(
        ["profile", "create", "dev", "--endpoint", "http://other:6006"],
        { logSpy, errorSpy, exitSpy }
      )
    ).rejects.toThrow();

    const errOutput = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(errOutput).toContain('"dev" already exists');
  });

  it("create exits with error on corrupt profiles file (strict mode)", async () => {
    const pxDir = path.join(tmpDir, "px");
    fs.mkdirSync(pxDir, { recursive: true });
    fs.writeFileSync(
      path.join(pxDir, "profiles.json"),
      "not-valid-json",
      "utf-8"
    );

    await expect(
      runAuthCommand(
        ["profile", "create", "dev", "--endpoint", "http://localhost:6006"],
        { logSpy, errorSpy, exitSpy }
      )
    ).rejects.toThrow();

    const errOutput = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(errOutput).toContain("Error reading profiles file");
  });

  // --- auth profiles delete ---

  it("delete removes an existing profile from disk", async () => {
    writeTempProfiles(tmpDir, {
      version: 1,
      activeProfile: null,
      profiles: {
        dev: { endpoint: "http://localhost:6006" },
        prod: { endpoint: "https://prod.example.com" },
      },
    });

    await runAuthCommand(["profile", "delete", "dev"], {
      logSpy,
      errorSpy,
      exitSpy,
    });

    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("dev");
    expect(output).toContain("http://localhost:6006");

    const profilesPath = path.join(tmpDir, "px", "profiles.json");
    const data: ProfilesFile = JSON.parse(
      fs.readFileSync(profilesPath, "utf-8")
    );
    expect(data.profiles.dev).toBeUndefined();
    expect(data.profiles.prod).toBeDefined();
  });

  it("delete clears activeProfile when the active profile is deleted", async () => {
    writeTempProfiles(tmpDir, {
      version: 1,
      activeProfile: "dev",
      profiles: { dev: { endpoint: "http://localhost:6006" } },
    });

    await runAuthCommand(["profile", "delete", "dev"], {
      logSpy,
      errorSpy,
      exitSpy,
    });

    const profilesPath = path.join(tmpDir, "px", "profiles.json");
    const data: ProfilesFile = JSON.parse(
      fs.readFileSync(profilesPath, "utf-8")
    );
    expect(data.activeProfile).toBeNull();

    // Should warn to stderr that the stored default profile was deleted
    const errOutput = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(errOutput).toContain("Warning");
    expect(errOutput).toContain("stored default profile");
  });

  it("delete exits with error when profile does not exist", async () => {
    await expect(
      runAuthCommand(["profile", "delete", "nonexistent"], {
        logSpy,
        errorSpy,
        exitSpy,
      })
    ).rejects.toThrow();

    const errOutput = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(errOutput).toContain('"nonexistent" does not exist');
  });

  it("delete exits with error on corrupt profiles file (strict mode)", async () => {
    const pxDir = path.join(tmpDir, "px");
    fs.mkdirSync(pxDir, { recursive: true });
    fs.writeFileSync(
      path.join(pxDir, "profiles.json"),
      '{"version":99,"activeProfile":null,"profiles":{}}',
      "utf-8"
    );

    await expect(
      runAuthCommand(["profile", "delete", "dev"], {
        logSpy,
        errorSpy,
        exitSpy,
      })
    ).rejects.toThrow();

    const errOutput = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(errOutput).toContain("Error reading profiles file");
  });

  it("delete clears activeProfile but does not mark row active when PHOENIX_PROFILE selects a different existing profile", async () => {
    // Scenario: file.activeProfile = "dev" (stored default), but PHOENIX_PROFILE
    // overrides to "prod". Deleting "dev" should:
    //   1. Clear file.activeProfile (stored cleanup)
    //   2. NOT mark the deleted row as active in output (prod is effectively active)
    //   3. Emit the stored-default warning
    writeTempProfiles(tmpDir, {
      version: 1,
      activeProfile: "dev",
      profiles: {
        dev: { endpoint: "http://localhost:6006" },
        prod: { endpoint: "https://prod.example.com" },
      },
    });
    process.env.PHOENIX_PROFILE = "prod";

    await runAuthCommand(["profile", "delete", "dev"], {
      logSpy,
      errorSpy,
      exitSpy,
    });

    // Stored activeProfile must be cleared
    const profilesPath = path.join(tmpDir, "px", "profiles.json");
    const data: ProfilesFile = JSON.parse(
      fs.readFileSync(profilesPath, "utf-8")
    );
    expect(data.activeProfile).toBeNull();
    expect(data.profiles.dev).toBeUndefined();

    // Deleted row must NOT be marked active in output (prod is effectively active)
    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    // In pretty format the active indicator (*) should not appear for the deleted row
    expect(output).not.toContain("*");

    // Warning should mention the stored default was deleted
    const errOutput = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(errOutput).toContain("Warning");
    expect(errOutput).toContain("stored default profile");
  });
});

// ---------------------------------------------------------------------------
// Auth switch command integration tests
// ---------------------------------------------------------------------------

describe("auth switch command integration", () => {
  let tmpDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.PHOENIX_HOST;
    delete process.env.PHOENIX_API_KEY;
    delete process.env.PHOENIX_PROFILE;

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-switch-int-"));
    process.env.XDG_CONFIG_HOME = tmpDir;

    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((_code?: number | string) => {
        throw new Error(`process.exit(${_code})`);
      });
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("switch sets the active profile and prints confirmation", async () => {
    writeTempProfiles(tmpDir, {
      version: 1,
      activeProfile: "dev",
      profiles: {
        dev: { endpoint: "http://localhost:6006" },
        prod: { endpoint: "https://prod.example.com" },
      },
    });

    await runAuthCommand(["switch", "prod"], { logSpy, errorSpy, exitSpy });

    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("prod");
    expect(output).toContain("https://prod.example.com");

    const profilesPath = path.join(tmpDir, "px", "profiles.json");
    const data: ProfilesFile = JSON.parse(
      fs.readFileSync(profilesPath, "utf-8")
    );
    expect(data.activeProfile).toBe("prod");
  });

  it("switch exits with error when the named profile does not exist", async () => {
    writeTempProfiles(tmpDir, {
      version: 1,
      activeProfile: null,
      profiles: { dev: { endpoint: "http://localhost:6006" } },
    });

    await expect(
      runAuthCommand(["switch", "nonexistent"], { logSpy, errorSpy, exitSpy })
    ).rejects.toThrow();

    const errOutput = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(errOutput).toContain('"nonexistent" does not exist');
  });

  it("switch exits with error on corrupt profiles file (strict mode)", async () => {
    const pxDir = path.join(tmpDir, "px");
    fs.mkdirSync(pxDir, { recursive: true });
    fs.writeFileSync(path.join(pxDir, "profiles.json"), "not-json", "utf-8");

    await expect(
      runAuthCommand(["switch", "dev"], { logSpy, errorSpy, exitSpy })
    ).rejects.toThrow();

    const errOutput = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(errOutput).toContain("Error reading profiles file");
  });

  it("switch from no active profile to a named profile", async () => {
    writeTempProfiles(tmpDir, {
      version: 1,
      activeProfile: null,
      profiles: {
        staging: { endpoint: "https://staging.example.com" },
      },
    });

    await runAuthCommand(["switch", "staging"], { logSpy, errorSpy, exitSpy });

    const profilesPath = path.join(tmpDir, "px", "profiles.json");
    const data: ProfilesFile = JSON.parse(
      fs.readFileSync(profilesPath, "utf-8")
    );
    expect(data.activeProfile).toBe("staging");
  });
});

// ---------------------------------------------------------------------------
// Auth status command integration tests
// ---------------------------------------------------------------------------

describe("auth status command integration", () => {
  let tmpDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.PHOENIX_HOST;
    delete process.env.PHOENIX_API_KEY;
    delete process.env.PHOENIX_PROFILE;

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-status-int-"));
    process.env.XDG_CONFIG_HOME = tmpDir;

    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((_code?: number | string) => {
        throw new Error(`process.exit(${_code})`);
      });
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("--profile nonexistent exits with error containing the profile name", async () => {
    writeTempProfiles(tmpDir, {
      version: 1,
      activeProfile: null,
      profiles: { dev: { endpoint: "http://localhost:6006" } },
    });
    process.env.PHOENIX_HOST = "http://localhost:6006";

    await expect(
      runAuthCommand(["status", "--profile", "nonexistent"], {
        logSpy,
        errorSpy,
        exitSpy,
      })
    ).rejects.toThrow();

    const errOutput = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(errOutput).toContain("nonexistent");
  });
});
