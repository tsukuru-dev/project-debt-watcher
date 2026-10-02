export const CONFIG_FILENAME = "debt-watcher.config.json";

export const CONFIG_KEYS = [
  "fresh", "markers", "includeFresh", "showAuthors", "order", "reportDirectory",
  "ageing", "buried",
] as const;

export type ConfigKey = typeof CONFIG_KEYS[number];

interface SharedSettings {
  fresh: number;
  markers: string[];
  includeFresh: boolean;
  showAuthors: boolean;
  order: "oldnew" | "newold";
  reportDirectory: string;
}

// Omitting both thresholds selects automatic bands. Fossil is older than buried.
type AgeBands =
  | { ageing?: never; buried?: never }
  | { ageing: number; buried: number };

export type DebtWatcherConfig = SharedSettings & AgeBands;

/** Preserve optional document metadata separately from scanning settings. */
export type ConfigurationDocument = DebtWatcherConfig & {
  $schema?: string;
  metadata?: Record<string, unknown>;
};

export type ConfigurationLocation =
  | { scope: "repository"; path: string; repositoryRoot: string }
  | { scope: "global"; path: string };

export function isConfigKey(value: string): value is ConfigKey {
  return (CONFIG_KEYS as readonly string[]).includes(value);
}
