import { readFile } from "node:fs/promises";
import type { ConfigurationDocument, ConfigurationLocation } from "./types.js";
import { validateConfiguration } from "./validate.js";

/** Read the saved file every time. Defaults are never silently substituted. */
export async function loadConfiguration(location: ConfigurationLocation): Promise<ConfigurationDocument> {
  let source: string;
  try {
    source = await readFile(location.path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      const scope = location.scope === "global" ? "personal" : "repository";
      throw new Error(
        `Missing ${scope} configuration: "${location.path}". `
        + "Create this file from the supplied templates/debt-watcher.config.json. "
        + "Automatic setup is not implemented yet.",
      );
    }
    throw new Error(`Cannot read configuration "${location.path}" (${code ?? "filesystem error"}).`);
  }

  let document: unknown;
  try {
    // Accept the UTF-8 BOM produced by some Windows editors, without rewriting it.
    document = JSON.parse(source.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error(`Invalid JSON in configuration "${location.path}". Check quotes, commas, and brackets.`);
  }
  try {
    return validateConfiguration(document);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid settings.";
    throw new Error(`Configuration "${location.path}": ${message}`);
  }
}
