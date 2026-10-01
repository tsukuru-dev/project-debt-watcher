import { randomUUID } from "node:crypto";
import { lstat, readFile, open, rename, link, unlink } from "node:fs/promises";
import { dirname, join, basename } from "node:path";

/** Missing is distinct from unreadable, non-regular or symbolic-link files. */
export async function readSetupFile(path: string): Promise<string | null> {
  try {
    if (!(await lstat(path)).isFile()) throw new Error("Expected a regular file: " + path);
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function assertUnchanged(path: string, original: string | null): Promise<void> {
  if (await readSetupFile(path) !== original) throw new Error("File changed during setup: " + path + ". Run init again.");
}

export async function assertWritable(path: string): Promise<void> {
  try {
    if (!((await lstat(path)).mode & 0o222)) throw new Error("File is read-only: " + path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function formatPackage(value: unknown, source: string | null): string {
  const newline = source?.includes("\r\n") ? "\r\n" : "\n";
  const indent = source?.match(/\n([\t ]+)"/)?.[1] ?? "  ";
  return (source?.startsWith("\uFEFF") ? "\uFEFF" : "")
    + JSON.stringify(value, null, indent).replaceAll("\n", newline) + newline;
}

/** Compare before replacing; never overwrite a newly appeared file. */
export async function writeSetupFile(path: string, text: string, original: string | null): Promise<void> {
  await assertUnchanged(path, original);
  if (text === original) return;
  await assertWritable(path);
  const temporary = join(dirname(path), "." + basename(path) + "." + randomUUID() + ".tmp");
  const mode = original === null ? 0o644 : (await lstat(path)).mode & 0o777;
  const file = await open(temporary, "wx", mode);
  try {
    try {
      await file.writeFile(text, "utf8");
      await file.sync();
    } finally { await file.close(); }
    await assertUnchanged(path, original);
    if (original === null) await link(temporary, path);
    else await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
