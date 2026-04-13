import { obscureApiKey } from "./auth";
import { formatTable } from "./formatTable";

export type OutputFormat = "pretty" | "json" | "raw";

export type ProfileListEntry = {
  name: string;
  endpoint?: string;
  apiKey?: string;
  project?: string;
  active: boolean;
};

export interface FormatProfilesOutputOptions {
  /**
   * Profiles to format.
   */
  profiles: ProfileListEntry[];
  /**
   * Output format. Defaults to `"pretty"`.
   */
  format?: OutputFormat;
}

export function formatProfilesOutput({
  profiles,
  format,
}: FormatProfilesOutputOptions): string {
  const selected = format || "pretty";
  // API keys are always masked in CLI output so agents that invoke profile
  // commands never pull plaintext credentials into their context. Users who
  // need the raw value can read ~/.px/profiles.json directly.
  const masked = profiles.map((p) => ({
    ...p,
    apiKey: p.apiKey ? obscureApiKey(p.apiKey) : undefined,
  }));
  if (selected === "raw") {
    return masked.map((p) => JSON.stringify(p)).join("\n");
  }
  if (selected === "json") {
    return JSON.stringify({ profiles: masked }, null, 2);
  }
  return formatProfilesPretty(profiles);
}

function formatProfilesPretty(profiles: ProfileListEntry[]): string {
  if (profiles.length === 0) {
    return "No profiles found";
  }

  const rows = profiles.map((p) => ({
    " ": p.active ? "*" : "",
    name: p.name,
    endpoint: p.endpoint ?? "",
    "api-key": p.apiKey ? obscureApiKey(p.apiKey) : "",
    project: p.project ?? "",
  }));

  return formatTable(rows);
}
