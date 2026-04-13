import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_PROFILES_FILE,
  ProfilesFileError,
  getActiveProfile,
  getConfigDir,
  getProfile,
  getProfilesPath,
  loadProfiles,
  parseProfilesFile,
  type ProfileEntry,
  type ProfilesFile,
  saveProfiles,
  validateProfileName,
} from "../src/profiles";

// ---------------------------------------------------------------------------
// parseProfilesFile
// ---------------------------------------------------------------------------

describe("parseProfilesFile", () => {
  it("returns ok=false for invalid JSON", () => {
    const result = parseProfilesFile("not-json{");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/Invalid JSON/i);
    }
  });

  it("returns ok=false for JSON array", () => {
    const result = parseProfilesFile("[]");
    expect(result.ok).toBe(false);
  });

  it("returns ok=false for JSON null", () => {
    const result = parseProfilesFile("null");
    expect(result.ok).toBe(false);
  });

  it("returns ok=false for JSON string primitive", () => {
    const result = parseProfilesFile('"hello"');
    expect(result.ok).toBe(false);
  });

  it("returns ok=false for unsupported version", () => {
    const raw = JSON.stringify({
      version: 2,
      activeProfile: null,
      profiles: {},
    });
    const result = parseProfilesFile(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/Unsupported profiles version 2/);
    }
  });

  it("returns ok=false when version is missing", () => {
    const raw = JSON.stringify({ activeProfile: null, profiles: {} });
    const result = parseProfilesFile(raw);
    expect(result.ok).toBe(false);
  });

  it("returns ok=false when activeProfile is a number", () => {
    const raw = JSON.stringify({ version: 1, activeProfile: 42, profiles: {} });
    const result = parseProfilesFile(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/activeProfile/);
    }
  });

  it("returns ok=false when profiles is an array", () => {
    const raw = JSON.stringify({
      version: 1,
      activeProfile: null,
      profiles: [],
    });
    const result = parseProfilesFile(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/profiles/);
    }
  });

  it("returns ok=false when a profile entry is not an object", () => {
    const raw = JSON.stringify({
      version: 1,
      activeProfile: null,
      profiles: { prod: "not-an-object" },
    });
    const result = parseProfilesFile(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/"prod"/);
    }
  });

  it("returns ok=false when a profile field has wrong type", () => {
    const raw = JSON.stringify({
      version: 1,
      activeProfile: null,
      profiles: { prod: { endpoint: 42 } },
    });
    const result = parseProfilesFile(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/"prod"\.endpoint/);
    }
  });

  it("returns ok=false when headers value is not a string", () => {
    const raw = JSON.stringify({
      version: 1,
      activeProfile: null,
      profiles: { prod: { headers: { "X-Key": 123 } } },
    });
    const result = parseProfilesFile(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/headers\["X-Key"\]/);
    }
  });

  it("returns ok=false when headers is an array", () => {
    const raw = JSON.stringify({
      version: 1,
      activeProfile: null,
      profiles: { prod: { headers: ["a", "b"] } },
    });
    const result = parseProfilesFile(raw);
    expect(result.ok).toBe(false);
  });

  it("silently strips unknown fields from profile entries (default strip mode)", () => {
    const raw = JSON.stringify({
      version: 1,
      activeProfile: null,
      profiles: {
        prod: { api_key: "secret", endpoint: "https://prod.example.com" },
      },
    });
    const result = parseProfilesFile(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Unknown field stripped, known field preserved
      expect(result.data.profiles.prod).toEqual({
        endpoint: "https://prod.example.com",
      });
      expect("api_key" in result.data.profiles.prod).toBe(false);
    }
  });

  it("silently strips camelCase typos from profile entries", () => {
    const raw = JSON.stringify({
      version: 1,
      activeProfile: null,
      profiles: { dev: { apikey: "abc" } },
    });
    const result = parseProfilesFile(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.profiles.dev).toEqual({});
      expect("apikey" in result.data.profiles.dev).toBe(false);
    }
  });

  it("returns ok=true for minimal valid file", () => {
    const raw = JSON.stringify({
      version: 1,
      activeProfile: null,
      profiles: {},
    });
    const result = parseProfilesFile(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.version).toBe(1);
      expect(result.data.activeProfile).toBeNull();
      expect(result.data.profiles).toEqual({});
    }
  });

  it("returns ok=true with activeProfile set to a string", () => {
    const raw = JSON.stringify({
      version: 1,
      activeProfile: "prod",
      profiles: { prod: { endpoint: "https://prod.example.com" } },
    });
    const result = parseProfilesFile(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.activeProfile).toBe("prod");
      expect(result.data.profiles.prod.endpoint).toBe(
        "https://prod.example.com"
      );
    }
  });

  it("returns ok=true for profile with all optional fields", () => {
    const raw = JSON.stringify({
      version: 1,
      activeProfile: "full",
      profiles: {
        full: {
          endpoint: "https://example.com",
          apiKey: "key123",
          project: "my-project",
          headers: { Authorization: "Bearer token" },
        },
      },
    });
    const result = parseProfilesFile(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const entry = result.data.profiles.full;
      expect(entry.endpoint).toBe("https://example.com");
      expect(entry.apiKey).toBe("key123");
      expect(entry.project).toBe("my-project");
      expect(entry.headers).toEqual({ Authorization: "Bearer token" });
    }
  });

  it("returns ok=true for profile with empty headers object", () => {
    const raw = JSON.stringify({
      version: 1,
      activeProfile: null,
      profiles: { dev: { headers: {} } },
    });
    const result = parseProfilesFile(raw);
    expect(result.ok).toBe(true);
  });

  it("returns ok=true for profile with only some fields set", () => {
    const raw = JSON.stringify({
      version: 1,
      activeProfile: null,
      profiles: { partial: { apiKey: "abc" } },
    });
    const result = parseProfilesFile(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.profiles.partial.apiKey).toBe("abc");
      expect(result.data.profiles.partial.endpoint).toBeUndefined();
    }
  });

  it("returns ok=true for multiple profiles", () => {
    const raw = JSON.stringify({
      version: 1,
      activeProfile: "staging",
      profiles: {
        dev: { endpoint: "http://localhost:6006" },
        staging: {
          endpoint: "https://staging.example.com",
          apiKey: "staging-key",
        },
        prod: { endpoint: "https://prod.example.com", apiKey: "prod-key" },
      },
    });
    const result = parseProfilesFile(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.data.profiles)).toHaveLength(3);
      expect(result.data.activeProfile).toBe("staging");
    }
  });
});

// ---------------------------------------------------------------------------
// validateProfileName
// ---------------------------------------------------------------------------

describe("validateProfileName", () => {
  it("accepts lowercase alphanumeric", () => {
    expect(validateProfileName("prod")).toBe(true);
  });

  it("accepts uppercase alphanumeric", () => {
    expect(validateProfileName("PROD")).toBe(true);
  });

  it("accepts mixed case with numbers", () => {
    expect(validateProfileName("MyProfile1")).toBe(true);
  });

  it("accepts hyphens", () => {
    expect(validateProfileName("my-profile")).toBe(true);
  });

  it("accepts underscores", () => {
    expect(validateProfileName("my_profile")).toBe(true);
  });

  it("accepts hyphens and underscores combined", () => {
    expect(validateProfileName("my-profile_v2")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(validateProfileName("")).toBe(false);
  });

  it("rejects string with leading space", () => {
    expect(validateProfileName(" prod")).toBe(false);
  });

  it("rejects string with trailing space", () => {
    expect(validateProfileName("prod ")).toBe(false);
  });

  it("rejects string with internal space", () => {
    expect(validateProfileName("my profile")).toBe(false);
  });

  it("rejects dots", () => {
    expect(validateProfileName("my.profile")).toBe(false);
  });

  it("rejects slashes", () => {
    expect(validateProfileName("my/profile")).toBe(false);
  });

  it("rejects at-sign", () => {
    expect(validateProfileName("my@profile")).toBe(false);
  });

  it("rejects colons", () => {
    expect(validateProfileName("my:profile")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getActiveProfile
// ---------------------------------------------------------------------------

describe("getActiveProfile", () => {
  const devEntry: ProfileEntry = { endpoint: "http://localhost:6006" };
  const prodEntry: ProfileEntry = {
    endpoint: "https://prod.example.com",
    apiKey: "prod-key",
  };

  const file: ProfilesFile = {
    version: 1,
    activeProfile: "dev",
    profiles: { dev: devEntry, prod: prodEntry },
  };

  it("returns { name, entry } when overrideName is provided and exists", () => {
    const result = getActiveProfile(file, "prod");
    expect(result).toEqual({ name: "prod", entry: prodEntry });
    expect(result?.entry).toBe(prodEntry);
  });

  it("returns undefined when overrideName is provided but does not exist", () => {
    const result = getActiveProfile(file, "nonexistent");
    expect(result).toBeUndefined();
  });

  it("returns { name, entry } for the activeProfile when no override", () => {
    const result = getActiveProfile(file);
    expect(result).toEqual({ name: "dev", entry: devEntry });
    expect(result?.entry).toBe(devEntry);
  });

  it("returns undefined when activeProfile is null and no override", () => {
    const noActive: ProfilesFile = { ...file, activeProfile: null };
    const result = getActiveProfile(noActive);
    expect(result).toBeUndefined();
  });

  it("returns undefined when activeProfile points to a nonexistent entry", () => {
    const missing: ProfilesFile = { ...file, activeProfile: "missing" };
    const result = getActiveProfile(missing);
    expect(result).toBeUndefined();
  });

  it("override takes precedence over activeProfile", () => {
    // activeProfile is "dev" but override says "prod"
    const result = getActiveProfile(file, "prod");
    expect(result?.name).toBe("prod");
    expect(result?.entry).toBe(prodEntry);
  });

  it("returns undefined on empty profiles with no active", () => {
    const empty: ProfilesFile = {
      version: 1,
      activeProfile: null,
      profiles: {},
    };
    expect(getActiveProfile(empty)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getProfile
// ---------------------------------------------------------------------------

describe("getProfile", () => {
  const devEntry: ProfileEntry = { endpoint: "http://localhost:6006" };
  const file: ProfilesFile = {
    version: 1,
    activeProfile: null,
    profiles: { dev: devEntry },
  };

  it("returns the profile entry when found", () => {
    expect(getProfile(file, "dev")).toBe(devEntry);
  });

  it("returns undefined for an unknown profile name", () => {
    expect(getProfile(file, "nonexistent")).toBeUndefined();
  });

  it("returns undefined on empty profiles", () => {
    const empty: ProfilesFile = {
      version: 1,
      activeProfile: null,
      profiles: {},
    };
    expect(getProfile(empty, "dev")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getConfigDir / getProfilesPath
// ---------------------------------------------------------------------------

describe("getConfigDir", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("falls back to ~/.px when XDG_CONFIG_HOME is unset", () => {
    delete process.env.XDG_CONFIG_HOME;
    const dir = getConfigDir();
    expect(dir).toBe(path.join(os.homedir(), ".px"));
  });

  it("uses XDG_CONFIG_HOME when set", () => {
    process.env.XDG_CONFIG_HOME = "/custom/xdg";
    const dir = getConfigDir();
    expect(dir).toBe("/custom/xdg/px");
  });
});

describe("getProfilesPath", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns path ending in profiles.json within getConfigDir()", () => {
    delete process.env.XDG_CONFIG_HOME;
    const p = getProfilesPath();
    expect(p).toBe(path.join(os.homedir(), ".px", "profiles.json"));
  });

  it("respects XDG_CONFIG_HOME for the profiles path", () => {
    process.env.XDG_CONFIG_HOME = "/custom/xdg";
    expect(getProfilesPath()).toBe("/custom/xdg/px/profiles.json");
  });
});

// ---------------------------------------------------------------------------
// loadProfiles / saveProfiles (I/O tests using a temp directory)
// ---------------------------------------------------------------------------

describe("loadProfiles / saveProfiles", () => {
  let tmpDir: string;
  let profilesPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-profiles-test-"));
    profilesPath = path.join(tmpDir, "profiles.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // --- loadProfiles: missing file ---

  it("returns DEFAULT_PROFILES_FILE when file does not exist (forgiving)", () => {
    const result = loadProfiles({ profilesPath });
    expect(result).toEqual(DEFAULT_PROFILES_FILE);
  });

  it("returns DEFAULT_PROFILES_FILE when file does not exist (strict)", () => {
    // ENOENT is always forgiving regardless of strict
    const result = loadProfiles({ strict: true, profilesPath });
    expect(result).toEqual(DEFAULT_PROFILES_FILE);
  });

  // --- loadProfiles: malformed file, forgiving mode ---

  it("returns DEFAULT_PROFILES_FILE and warns to stderr for invalid JSON (forgiving)", () => {
    fs.writeFileSync(profilesPath, "not-json", "utf-8");
    const stderrChunks: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: unknown) => {
      stderrChunks.push(String(chunk));
      return true;
    };
    try {
      const result = loadProfiles({ profilesPath });
      expect(result).toEqual(DEFAULT_PROFILES_FILE);
      expect(stderrChunks.join("")).toMatch(/Warning/i);
    } finally {
      process.stderr.write = originalWrite;
    }
  });

  // --- loadProfiles: malformed file, strict mode ---

  it("throws ProfilesFileError for invalid JSON (strict)", () => {
    fs.writeFileSync(profilesPath, "not-json", "utf-8");
    expect(() => loadProfiles({ strict: true, profilesPath })).toThrow(
      ProfilesFileError
    );
  });

  it("throws ProfilesFileError for unsupported version (strict)", () => {
    fs.writeFileSync(
      profilesPath,
      JSON.stringify({ version: 99, activeProfile: null, profiles: {} }),
      "utf-8"
    );
    expect(() => loadProfiles({ strict: true, profilesPath })).toThrow(
      ProfilesFileError
    );
  });

  it("throws ProfilesFileError for corrupt profile entry (strict)", () => {
    fs.writeFileSync(
      profilesPath,
      JSON.stringify({
        version: 1,
        activeProfile: null,
        profiles: { bad: "not-an-object" },
      }),
      "utf-8"
    );
    expect(() => loadProfiles({ strict: true, profilesPath })).toThrow(
      ProfilesFileError
    );
  });

  // --- loadProfiles: valid file ---

  it("loads a valid profiles file from disk", () => {
    const data: ProfilesFile = {
      version: 1,
      activeProfile: "dev",
      profiles: {
        dev: { endpoint: "http://localhost:6006", apiKey: "dev-key" },
      },
    };
    fs.writeFileSync(profilesPath, JSON.stringify(data, null, 2), "utf-8");

    const result = loadProfiles({ profilesPath });
    expect(result.version).toBe(1);
    expect(result.activeProfile).toBe("dev");
    expect(result.profiles.dev.endpoint).toBe("http://localhost:6006");
    expect(result.profiles.dev.apiKey).toBe("dev-key");
  });

  it("loads a file with multiple profiles", () => {
    const data: ProfilesFile = {
      version: 1,
      activeProfile: "staging",
      profiles: {
        dev: { endpoint: "http://localhost:6006" },
        staging: { endpoint: "https://staging.example.com" },
        prod: { endpoint: "https://prod.example.com", apiKey: "prod-key" },
      },
    };
    fs.writeFileSync(profilesPath, JSON.stringify(data, null, 2), "utf-8");

    const result = loadProfiles({ profilesPath });
    expect(Object.keys(result.profiles)).toHaveLength(3);
    expect(result.activeProfile).toBe("staging");
  });

  // --- saveProfiles ---

  it("writes valid JSON to the specified path", () => {
    const data: ProfilesFile = {
      version: 1,
      activeProfile: null,
      profiles: { dev: { endpoint: "http://localhost:6006" } },
    };
    saveProfiles(data, { profilesPath });

    const raw = fs.readFileSync(profilesPath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.profiles.dev.endpoint).toBe("http://localhost:6006");
  });

  it("writes human-readable JSON (2-space indent)", () => {
    const data: ProfilesFile = {
      version: 1,
      activeProfile: null,
      profiles: { dev: { endpoint: "http://localhost:6006" } },
    };
    saveProfiles(data, { profilesPath });

    const raw = fs.readFileSync(profilesPath, "utf-8");
    // 2-space indented JSON has lines starting with "  "
    expect(raw).toContain("  ");
    // ends with a newline
    expect(raw.endsWith("\n")).toBe(true);
  });

  it("writes file with mode 0o600 (owner read/write only)", () => {
    const data: ProfilesFile = {
      version: 1,
      activeProfile: null,
      profiles: { dev: { endpoint: "http://localhost:6006" } },
    };
    saveProfiles(data, { profilesPath });

    const stat = fs.statSync(profilesPath);
    // Mask to the low 9 permission bits (ignore file type bits)
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("creates parent directories if they do not exist", () => {
    const nestedPath = path.join(tmpDir, "nested", "deep", "profiles.json");
    const data: ProfilesFile = {
      version: 1,
      activeProfile: null,
      profiles: {},
    };
    saveProfiles(data, { profilesPath: nestedPath });
    expect(fs.existsSync(nestedPath)).toBe(true);
  });

  // --- round-trip: saveProfiles then loadProfiles ---

  it("round-trips: save then load returns identical data", () => {
    const data: ProfilesFile = {
      version: 1,
      activeProfile: "prod",
      profiles: {
        dev: {
          endpoint: "http://localhost:6006",
          apiKey: "dev-key",
          project: "dev-project",
          headers: { "X-Custom": "value" },
        },
        prod: {
          endpoint: "https://prod.example.com",
          apiKey: "prod-key",
        },
      },
    };

    saveProfiles(data, { profilesPath });
    const loaded = loadProfiles({ profilesPath });

    expect(loaded).toEqual(data);
  });

  it("round-trip preserves null activeProfile", () => {
    const data: ProfilesFile = {
      version: 1,
      activeProfile: null,
      profiles: {},
    };
    saveProfiles(data, { profilesPath });
    const loaded = loadProfiles({ profilesPath });
    expect(loaded.activeProfile).toBeNull();
  });

  it("overwrites an existing file on save", () => {
    const first: ProfilesFile = {
      version: 1,
      activeProfile: null,
      profiles: { dev: { endpoint: "http://localhost:6006" } },
    };
    saveProfiles(first, { profilesPath });

    const second: ProfilesFile = {
      version: 1,
      activeProfile: "prod",
      profiles: { prod: { endpoint: "https://prod.example.com" } },
    };
    saveProfiles(second, { profilesPath });

    const loaded = loadProfiles({ profilesPath });
    expect(loaded).toEqual(second);
    expect(loaded.profiles.dev).toBeUndefined();
  });
});
