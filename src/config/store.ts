import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { ConfigurationDocument, ConfigurationLocation } from "./types.js";
import { validateConfiguration } from "./validate.js";

export class MissingConfigurationError extends Error {
  constructor(location: ConfigurationLocation) {
    const scope = location.scope === "global" ? "personal" : "repository";
    const guidance = location.scope === "global"
      ? "Run debt-watcher --global config --set fresh=30 to create personal defaults."
      : "Create this file from the supplied templates/debt-watcher.config.json. Automatic setup is not implemented yet.";
    super(`Missing ${scope} configuration: "${location.path}". ${guidance}`);
    this.name = "MissingConfigurationError";
  }
}

export interface ConfigurationSnapshot {
  document: ConfigurationDocument;
  source: string;
}

function parseConfiguration(source: string, path: string): ConfigurationDocument {
  let document: unknown;
  try {
    document = JSON.parse(source.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error(`Invalid JSON in configuration "${path}". Check quotes, commas, and brackets.`);
  }
  try {
    return validateConfiguration(document);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid settings.";
    throw new Error(`Configuration "${path}": ${message}`);
  }
}

/** Retain the original text to detect edits made between reading and saving. */
export async function readConfiguration(location: ConfigurationLocation): Promise<ConfigurationSnapshot> {
  let source: string;
  try {
    source = await readFile(location.path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new MissingConfigurationError(location);
    }
    throw new Error(`Cannot read configuration "${location.path}" (${code ?? "filesystem error"}).`);
  }

  return { document: parseConfiguration(source, location.path), source };
}

/** Read the saved file every time. Defaults are never silently substituted. */
export async function loadConfiguration(location: ConfigurationLocation): Promise<ConfigurationDocument> {
  return (await readConfiguration(location)).document;
}

/** Used only when an explicit personal edit creates its missing target file. */
export async function loadDefaultConfiguration(): Promise<ConfigurationDocument> {
  const path = new URL("../../templates/debt-watcher.config.json", import.meta.url);
  return parseConfiguration(await readFile(path, "utf8"), path.href);
}

function formatConfiguration(document: ConfigurationDocument, original: string | null): string {
  const newline = original?.includes("\r\n") ? "\r\n" : "\n";
  const indent = original?.match(/\n([\t ]+)"/)?.[1] ?? "  ";
  const bom = original?.startsWith("\uFEFF") ? "\uFEFF" : "";
  return bom + JSON.stringify(document, null, indent).replaceAll("\n", newline) + newline;
}

/**
 * Write a complete, validated document beside its destination before replacing it.
 * A null original permits first-use personal defaults only, never repository setup.
 */
export async function saveConfiguration(
  location: ConfigurationLocation,
  document: ConfigurationDocument,
  original: string | null,
): Promise<void> {
  validateConfiguration(document);
  if (original === null && location.scope !== "global") {
    throw new Error("Repository configuration must already exist before editing.");
  }
  const directory = dirname(location.path);
  const temporary = join(directory, `.${basename(location.path)}.${randomUUID()}.tmp`);
  let temporaryCreated = false;
  try {
    let mode = 0o600;
    if (original !== null) {
      const stats = await lstat(location.path);
      if (!stats.isFile()) throw new Error("The configuration must be a regular file, not a symbolic link or directory.");
      if (!(stats.mode & 0o222)) throw new Error("The configuration file is read-only.");
      mode = stats.mode & 0o777;
    } else {
      await mkdir(directory, { recursive: true });
    }
    const file = await open(temporary, "wx", mode);
    temporaryCreated = true;
    try {
      await file.writeFile(formatConfiguration(document, original), "utf8");
      await file.sync();
    } finally {
      await file.close();
    }

    if (original !== null) {
      const stats = await lstat(location.path);
      if (!stats.isFile() || await readFile(location.path, "utf8") !== original) {
        throw new Error("The configuration changed while editing. Run the command again.");
      }
      await rename(temporary, location.path);
      temporaryCreated = false;
    } else {
      // Publish only if the target is still absent; link fails rather than overwriting it.
      await link(temporary, location.path);
    }
  } catch (error) {
    const message = (error as NodeJS.ErrnoException).code === "EEXIST"
      ? "A configuration file already exists. Run the command again to edit it."
      : error instanceof Error ? error.message : "Filesystem error.";
    throw new Error(`Cannot save configuration "${location.path}": ${message}`);
  } finally {
    if (temporaryCreated) await unlink(temporary);
  }
}
