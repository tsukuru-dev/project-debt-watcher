import { isDeepStrictEqual } from "node:util";
import { isConfigKey, type ConfigKey, type ConfigurationDocument } from "./types.js";
import { validateConfiguration, validateMarkers } from "./validate.js";

export type ConfigurationEditInput =
  | { action: "set"; assignments: readonly string[] }
  | { action: "add" | "remove"; assignment: string };

type SettingValue = number | boolean | string | string[];
export type ConfigurationEdit =
  | { action: "set"; values: Partial<Record<ConfigKey, SettingValue>> }
  | { action: "add" | "remove"; markers: string[] };

function splitAssignment(input: string): [ConfigKey, string] {
  const separator = input.indexOf("=");
  const key = input.slice(0, separator).trim();
  const value = input.slice(separator + 1);
  if (separator < 1 || !value.trim()) throw new Error("Use key=value with a non-empty key and value.");
  if (!isConfigKey(key)) throw new Error(`Unknown configuration key '${key}'.`);
  return [key, value];
}

function markersFrom(value: string, deduplicate: boolean): string[] {
  let markers = value.split(",").map((marker) => marker.trim());
  if (deduplicate) markers = [...new Set(markers)];
  validateMarkers(markers);
  return markers;
}

function settingValue(key: ConfigKey, value: string): SettingValue {
  const trimmed = value.trim();
  switch (key) {
    case "fresh":
    case "ageing":
    case "buried":
      if (!/^\d+$/.test(trimmed) || !Number.isSafeInteger(Number(trimmed))) {
        throw new Error(`${key} must be a non-negative whole number of days.`);
      }
      return Number(trimmed);
    case "includeFresh":
    case "showAuthors":
      if (trimmed !== "true" && trimmed !== "false") throw new Error(`${key} must be true or false.`);
      return trimmed === "true";
    case "order":
      if (trimmed !== "oldnew" && trimmed !== "newold") throw new Error("order must be 'oldnew' or 'newold'.");
      return trimmed;
    case "markers":
      return markersFrom(value, false);
    case "reportDirectory":
      // Keep a quoted path intact, including spaces and any additional equals signs.
      return value;
  }
}

/** Parse the requested edit before any first-use personal configuration is created. */
export function parseConfigurationEdit(input: ConfigurationEditInput): ConfigurationEdit {
  if (input.action === "set") {
    if (!input.assignments.length) throw new Error("--set requires at least one key=value assignment.");
    const values: Partial<Record<ConfigKey, SettingValue>> = {};
    for (const assignment of input.assignments) {
      const [key, value] = splitAssignment(assignment);
      if (Object.hasOwn(values, key)) throw new Error(`Duplicate setting '${key}'. Specify it once in --set.`);
      values[key] = settingValue(key, value);
    }
    return { action: "set", values };
  }
  const [key, value] = splitAssignment(input.assignment);
  if (key !== "markers") throw new Error("--add and --remove accept only markers=... .");
  return { action: input.action, markers: markersFrom(value, true) };
}

export interface ConfigurationEditResult {
  document: ConfigurationDocument;
  changed: boolean;
  message: string;
}

/** Apply all assignments together, preserving unrelated values and document metadata. */
export function applyConfigurationEdit(
  current: ConfigurationDocument,
  edit: ConfigurationEdit,
): ConfigurationEditResult {
  validateConfiguration(current);
  const candidate: Record<string, unknown> = { ...current };
  let message: string;
  if (edit.action === "set") {
    Object.assign(candidate, edit.values);
    const useAutomatic = Object.hasOwn(edit.values, "fresh")
      && !["ageing", "buried"].some((key) => Object.hasOwn(edit.values, key));
    if (useAutomatic) {
      delete candidate.ageing;
      delete candidate.buried;
    }
    message = `Updated settings: ${Object.keys(edit.values).join(", ")}.`
      + (useAutomatic ? " Using automatic age bands." : "");
  } else if (edit.action === "add") {
    const added = edit.markers.filter((marker) => !current.markers.includes(marker));
    candidate.markers = [...current.markers, ...added];
    message = added.length ? `Added markers: ${added.join(", ")}.`
      : "No changes: all requested markers are already configured.";
  } else {
    const removed = current.markers.filter((marker) => edit.markers.includes(marker));
    candidate.markers = current.markers.filter((marker) => !edit.markers.includes(marker));
    message = removed.length ? `Removed markers: ${removed.join(", ")}.`
      : "No changes: none of the requested markers are configured.";
  }
  const document = validateConfiguration(candidate);
  const changed = !isDeepStrictEqual(document, current);
  if (!changed && edit.action === "set") message = "No changes: the requested settings are already saved.";
  return { document, changed, message };
}
