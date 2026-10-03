import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ReportFilters } from "../commands/arguments.js";
import type { DebtWatcherConfig } from "../config/types.js";
import { validateConfiguration } from "../config/validate.js";
import { userConfigDirectory, type UserPathOptions } from "./paths.js";

/** The exact exported view, with enough context to identify when and where it came from. */
export interface LatestReportSnapshot {
  version: 1;
  repositoryRoot: string;
  generatedAt: string;
  checkoutBranch: string | null;
  checkoutCommit: string | null;
  scope: "local" | "remote";
  scannedBranches: Array<{ ref: string; commitId: string }>;
  settings: DebtWatcherConfig;
  filters: ReportFilters & { includeFresh: boolean };
  order: "oldnew" | "newold";
  markdown: string;
}

export function reportSnapshotPath(repositoryRoot: string, options: UserPathOptions = {}): string {
  const identity = (options.platform ?? process.platform) === "win32"
    ? repositoryRoot.toLowerCase() : repositoryRoot;
  const key = createHash("sha256").update(identity).digest("hex");
  return join(userConfigDirectory(options), "report-snapshots", `${key}.json`);
}

/** Replace a single repository's snapshot atomically, leaving other reports alone. */
export async function rememberReport(snapshot: LatestReportSnapshot, options: UserPathOptions = {}): Promise<void> {
  const path = reportSnapshotPath(snapshot.repositoryRoot, options);
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `.${randomUUID()}.tmp`);
  const file = await open(temporary, "wx", 0o600);
  try {
    try {
      await file.writeFile(JSON.stringify(snapshot) + "\n", "utf8");
      await file.sync();
    } finally { await file.close(); }
    try {
      const existing = await lstat(path);
      if (!existing.isFile()) throw new Error(`Report cache is not a regular file: "${path}".`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

/** Read only the entry for this canonical worktree; missing and corrupt are distinct. */
export async function latestReport(repositoryRoot: string, options: UserPathOptions = {}): Promise<LatestReportSnapshot | null> {
  const path = reportSnapshotPath(repositoryRoot, options);
  let source: string;
  try {
    const stats = await lstat(path);
    if (!stats.isFile()) throw new Error(`Report cache is not a regular file: "${path}".`);
    if (stats.size > 64 * 1024 * 1024) throw new Error(`Report cache is too large: "${path}".`);
    source = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let value: unknown;
  try { value = JSON.parse(source); }
  catch { throw new Error(`Report cache is invalid: "${path}". Generate a new report to replace it.`); }
  if (!value || typeof value !== "object") throw new Error(`Report cache is invalid: "${path}".`);
  const saved = value as Partial<LatestReportSnapshot>;
  if (saved.version !== 1 || saved.repositoryRoot !== repositoryRoot || typeof saved.generatedAt !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(saved.generatedAt)
    || !Number.isFinite(Date.parse(saved.generatedAt))
    || typeof saved.markdown !== "string" || !saved.markdown.endsWith("\n")
    || !saved.settings || typeof saved.settings.reportDirectory !== "string"
    || (saved.checkoutBranch !== null && typeof saved.checkoutBranch !== "string")
    || (saved.checkoutCommit !== null && typeof saved.checkoutCommit !== "string")
    || (typeof saved.checkoutBranch === "string" && /[\u0000-\u001f\u007f-\u009f]/u.test(saved.checkoutBranch))
    || (typeof saved.checkoutCommit === "string" && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(saved.checkoutCommit))
    || !Array.isArray(saved.scannedBranches)
    || saved.scannedBranches.some((branch) => !branch || typeof branch.ref !== "string"
      || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(branch.commitId))
    || !saved.filters || typeof saved.filters.includeFresh !== "boolean"
    || !["local", "remote"].includes(saved.scope ?? "")
    || !["oldnew", "newold"].includes(saved.order ?? "")) {
    throw new Error(`Report cache is invalid or belongs to another repository: "${path}".`);
  }
  try { validateConfiguration(saved.settings); }
  catch { throw new Error(`Report cache settings are invalid: "${path}". Generate a new report to replace it.`); }
  return saved as LatestReportSnapshot;
}
