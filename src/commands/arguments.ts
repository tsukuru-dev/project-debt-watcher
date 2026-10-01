import { InvalidArgumentError } from "commander";

export interface SharedArguments {
  repo?: string;
  global?: boolean;
}

export interface InitArguments extends SharedArguments {
  dryRun?: boolean;
}

export interface ReportFilters {
  type?: Array<"code" | "branches" | "issues">;
  author?: string;
  includeFresh?: boolean;
}

export interface GraveyardArguments extends SharedArguments {
  summary?: "types" | "blame";
  save?: true | "latest";
  output?: string;
  remote?: boolean;
  all?: boolean;
  fresh?: number;
  ageing?: number;
  buried?: number;
  fossil?: number;
  markers?: string[];
  order?: "oldnew" | "newold";
  filter?: ReportFilters;
}

export interface ConfigArguments extends SharedArguments {
  // Keep assignments intact until the configuration layer can validate full settings.
  set?: string[];
  add?: string;
  remove?: string;
  list?: true | string;
  copyFrom?: "repo" | "global";
}

export function nonEmpty(value: string): string {
  if (!value.trim()) {
    throw new InvalidArgumentError("The value must not be empty.");
  }
  return value;
}

export function parseDays(value: string): number {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new InvalidArgumentError("Use a non-negative whole number of days.");
  }
  return Number(value);
}

export function parseMarkers(value: string): string[] {
  const markers = value.split(",").map((marker) => marker.trim());
  if (markers.some((marker) => !marker)) {
    throw new InvalidArgumentError("Comma-separated lists must not contain empty entries.");
  }
  return markers;
}

function assignment(value: string): [string, string] {
  const separator = value.indexOf("=");
  const key = value.slice(0, separator).trim();
  const setting = value.slice(separator + 1).trim();
  if (separator < 1 || !key || !setting) {
    throw new InvalidArgumentError("Use key=value with a non-empty key and value.");
  }
  return [key, setting];
}

export function parseFilter(value: string, previous: ReportFilters = {}): ReportFilters {
  const [key, setting] = assignment(value);
  const filters = { ...previous };
  const property = key === "includefresh" ? "includeFresh" : key;
  if (Object.hasOwn(filters, property)) {
    throw new InvalidArgumentError(`Duplicate filter '${key}'. Specify each filter once.`);
  }

  switch (key) {
    case "type": {
      const types = parseMarkers(setting);
      if (types.some((type) => !["code", "branches", "issues"].includes(type))) {
        throw new InvalidArgumentError("Debt types are code, branches, and issues.");
      }
      // Scanner availability is checked when report execution is implemented.
      filters.type = types as NonNullable<ReportFilters["type"]>;
      break;
    }
    case "author":
      filters.author = setting;
      break;
    case "includefresh":
      if (setting !== "true" && setting !== "false") {
        throw new InvalidArgumentError("includefresh must be true or false.");
      }
      filters.includeFresh = setting === "true";
      break;
    default:
      throw new InvalidArgumentError(`Unknown filter '${key}'. Use type, author, or includefresh.`);
  }
  return filters;
}

export function validateScope(command: string, options: SharedArguments): void {
  if (options.global && command !== "config") {
    throw new InvalidArgumentError("--global is only valid with the config command.");
  }
}

export function validateGraveyard(options: GraveyardArguments): void {
  validateScope("graveyard", options);
  if (options.output !== undefined && options.save === undefined) {
    throw new InvalidArgumentError("--output requires --save or --save latest.");
  }
  if (options.save === "latest") {
    const changingOptions = [
      "summary", "order", "filter", "fresh", "ageing", "buried", "fossil",
      "markers", "remote", "all",
    ] as const;
    const conflict = changingOptions.find((key) => options[key] !== undefined);
    if (conflict) {
      throw new InvalidArgumentError(`--save latest cannot be combined with --${conflict}.`);
    }
  }
}

export function validateConfig(options: ConfigArguments): void {
  if (options.global && options.repo !== undefined && options.copyFrom !== "repo") {
    throw new InvalidArgumentError("--global with --repo requires config --copy-from repo.");
  }
  if (options.copyFrom !== undefined) {
    const source = options.global ? "repo" : "global";
    if (options.copyFrom !== source) {
      throw new InvalidArgumentError(`For this configuration scope, use --copy-from ${source}.`);
    }
  }

  const keys = new Set<string>();
  for (const value of options.set ?? []) {
    const [key] = assignment(value);
    if (keys.has(key)) {
      throw new InvalidArgumentError(`Duplicate setting '${key}'. Specify it once in --set.`);
    }
    keys.add(key);
  }
  for (const value of [options.add, options.remove]) {
    if (value !== undefined) {
      const [key, list] = assignment(value);
      if (key !== "markers") {
        throw new InvalidArgumentError("--add and --remove currently accept only markers=... .");
      }
      parseMarkers(list);
    }
  }
}
