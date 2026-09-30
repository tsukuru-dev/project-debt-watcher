import { CONFIG_KEYS, type ConfigurationDocument } from "./types.js";

export class ConfigurationValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid configuration:\n${problems.map((problem) => `- ${problem}`).join("\n")}`);
    this.name = "ConfigurationValidationError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDays(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !value.includes("\0");
}

function assertConfiguration(value: unknown): asserts value is ConfigurationDocument {
  if (!isObject(value)) {
    throw new ConfigurationValidationError(["The configuration must be a JSON object."]);
  }

  const problems: string[] = [];
  const allowed = new Set<string>([...CONFIG_KEYS, "$schema", "metadata"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) problems.push(`Unknown configuration key '${key}'.`);
  }

  if (!isDays(value.fresh)) problems.push("fresh must be a non-negative whole number of days.");
  for (const key of ["includeFresh", "showAuthors"] as const) {
    if (typeof value[key] !== "boolean") problems.push(`${key} must be true or false.`);
  }
  if (value.order !== "oldnew" && value.order !== "newold") {
    problems.push("order must be 'oldnew' or 'newold'.");
  }
  if (!isText(value.reportDirectory)) problems.push("reportDirectory must be a non-empty path string without null characters.");

  if (!Array.isArray(value.markers)) {
    problems.push("markers must be an array of plain strings.");
  } else {
    const seen = new Set<string>();
    for (const [index, marker] of value.markers.entries()) {
      if (!isText(marker)) {
        problems.push(`markers[${index}] must be a non-empty string without null characters.`);
        continue;
      }
      if (marker !== marker.trim()) problems.push(`markers[${index}] must not have surrounding whitespace.`);
      if (/^(?:\/\/|\/\*|#|<!--|\{#|\{\/\*|\{%\s*comment\b)/.test(marker)
        || /(?:\*\/|-->|#\})$/.test(marker)) {
        problems.push(`markers[${index}] must contain marker text without language comment delimiters.`);
      }
      if (seen.has(marker)) problems.push(`markers contains the duplicate '${marker}'.`);
      seen.add(marker);
    }
  }

  const customKeys = ["ageing", "buried", "fossil"] as const;
  if (customKeys.some((key) => Object.hasOwn(value, key))) {
    if (!customKeys.every((key) => Object.hasOwn(value, key))) {
      problems.push("Custom age bands require ageing, buried, and fossil together.");
    }
    for (const key of customKeys) {
      if (Object.hasOwn(value, key) && !isDays(value[key])) {
        problems.push(`${key} must be a non-negative whole number of days.`);
      }
    }
    if (isDays(value.ageing) && isDays(value.buried) && isDays(value.fossil)
      && !(value.ageing < value.buried && value.buried < value.fossil)) {
      problems.push("Custom age bands must increase strictly: ageing < buried < fossil.");
    }
  }

  if (Object.hasOwn(value, "$schema") && !isText(value.$schema)) {
    problems.push("$schema, when present, must be a non-empty string.");
  }
  if (Object.hasOwn(value, "metadata") && !isObject(value.metadata)) {
    problems.push("metadata, when present, must be a JSON object.");
  }
  if (problems.length) throw new ConfigurationValidationError(problems);
}

/** Validate saved values without adding defaults, coercing types, or mutating the document. */
export function validateConfiguration(value: unknown): ConfigurationDocument {
  assertConfiguration(value);
  return value;
}
