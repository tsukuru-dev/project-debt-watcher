import { lstat, mkdir, open, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { confirm } from "../terminal/prompts.js";

export interface ExportOptions {
  repositoryRoot: string;
  invocationDirectory: string;
  configuredDirectory: string;
  output?: string;
  generatedAt: string;
  interactive: boolean;
  confirm?: (question: string) => Promise<boolean>;
  chooseMissingDirectory?: (directory: string) => Promise<"create" | "retry" | "other" | "cancel">;
  askDirectory?: () => Promise<string>;
}

export interface SavedExport { path: string; alternateDirectory?: string }

async function ask(question: string): Promise<string> {
  const reader = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await reader.question(question)).trim(); }
  finally { reader.close(); }
}

async function missingChoice(directory: string): Promise<"create" | "retry" | "other" | "cancel"> {
  while (true) {
    const choice = await ask(`Missing report directory: ${directory}\n[1] Create it  [2] Retry after creating it  [3] Choose another directory  [4] Cancel: `);
    if (choice === "1") return "create";
    if (choice === "2") return "retry";
    if (choice === "3") return "other";
    if (choice === "4" || choice === "") return "cancel";
  }
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    const stats = await lstat(path);
    if (!stats.isDirectory()) throw new Error(`Report destination is not a directory: "${path}".`);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Write only to the requested location; never create or overwrite silently. */
export async function saveMarkdownReport(markdown: string, options: ExportOptions): Promise<SavedExport> {
  const configured = isAbsolute(options.configuredDirectory)
    ? resolve(options.configuredDirectory) : resolve(options.repositoryRoot, options.configuredDirectory);
  const timestamp = options.generatedAt.replace(/[:.]/gu, "-");
  const name = options.output === undefined ? `debt-finder-report-${timestamp}.md` : basename(options.output);
  let directory = options.output === undefined ? configured
    : dirname(resolve(options.invocationDirectory, options.output));
  let alternateDirectory: string | undefined;
  while (!await directoryExists(directory)) {
    if (!options.interactive) throw new Error(`Report directory does not exist: "${directory}". Create it or change reportDirectory in the configuration.`);
    const choice = await (options.chooseMissingDirectory ?? missingChoice)(directory);
    if (choice === "cancel") throw new Error("Report saving cancelled.");
    if (choice === "create") await mkdir(directory, { recursive: true });
    if (choice === "other") {
      const alternative = await (options.askDirectory ?? (() => ask("Other report directory: ")))();
      if (!alternative.trim()) throw new Error("Report saving cancelled: no directory was chosen.");
      directory = resolve(options.invocationDirectory, alternative);
      alternateDirectory = directory;
    }
  }
  const path = resolve(directory, name);
  try {
    const file = await open(path, "wx");
    try { await file.writeFile(markdown, "utf8"); }
    catch (error) { await file.close(); await unlink(path); throw error; }
    await file.close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const stats = await lstat(path);
    if (!stats.isFile()) throw new Error(`Report destination is not a regular file: "${path}".`);
    if (!options.interactive || !await (options.confirm ?? confirm)(`Overwrite existing report "${path}"?`)) {
      throw new Error(`Report already exists: "${path}". Choose another --output path or confirm overwrite interactively.`);
    }
    await writeFile(path, markdown, "utf8");
  }
  return { path, ...(alternateDirectory === undefined ? {} : { alternateDirectory }) };
}
