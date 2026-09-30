export const CONFIG_FILENAME = "debt-watcher.config.json";

export const CONFIG_KEYS = [
  "fresh", "markers", "includeFresh", "showAuthors", "order", "reportDirectory",
  "ageing", "buried", "fossil",
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

// Omitting all three thresholds selects automatic bands. A custom set must be complete.
type AgeBands =
  | { ageing?: never; buried?: never; fossil?: never }
  | { ageing: number; buried: number; fossil: number };

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
