import { assertObjectId } from "./branches.js";
import { runGitBytes, type GitContext } from "./client.js";
import { languageForPath, type SourceLanguage } from "../scanners/comments/languages.js";

export interface CommittedSourceFile {
  path: string;
  blobId: string;
  size: number;
  language: SourceLanguage;
  mode: "100644" | "100755";
}

export const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
export type SourceRead = { kind: "text"; text: string }
  | { kind: "skipped"; reason: "too-large" | "binary" | "invalid-utf8" };

/** Enumerate the entire immutable tree, even when invoked from a nested directory. */
export async function listSourceFiles(commitId: string, context: GitContext): Promise<CommittedSourceFile[]> {
  assertObjectId(commitId);
  const bytes = await runGitBytes(["--no-lazy-fetch", "--no-replace-objects", "ls-tree", "--full-tree", "-r", "-l", "-z", commitId],
    context, 32 * 1024 * 1024);
  let source: string;
  try { source = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new Error("Git tree contains filenames that are not valid UTF-8; source enumeration stopped."); }
  const files: CommittedSourceFile[] = [];
  for (const record of source.split("\0")) {
    if (!record) continue;
    const entry = /^([0-7]{6}) ([a-z]+) ([a-f0-9]+) +(-|\d+)\t([\s\S]+)$/.exec(record);
    if (!entry) throw new Error("Unexpected Git tree entry.");
    const [, mode, type, blobId, rawSize, path] = entry;
    if ((mode !== "100644" && mode !== "100755") || type !== "blob") continue;
    const language = languageForPath(path!);
    if (!language) continue;
    assertObjectId(blobId!);
    const size = Number(rawSize);
    if (!Number.isSafeInteger(size) || size < 0 || rawSize === "-") throw new Error("Invalid Git blob size.");
    files.push({ path: path!, blobId: blobId!, size, mode, language });
  }
  return files;
}

/** Read objects directly: filenames never become revision syntax, pathspecs or shell commands. */
export async function readSourceFile(file: CommittedSourceFile, context: GitContext, maxBytes = MAX_SOURCE_BYTES): Promise<SourceRead> {
  assertObjectId(file.blobId);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("Source size limit must be a positive integer.");
  if (!Number.isSafeInteger(file.size) || file.size < 0) throw new Error("Invalid Git blob size.");
  if (file.size > maxBytes) return { kind: "skipped", reason: "too-large" };
  const bytes = await runGitBytes(["--no-lazy-fetch", "--no-replace-objects", "cat-file", "blob", file.blobId], context, maxBytes);
  if (bytes.length !== file.size) throw new Error("Git blob size changed or does not match its tree entry.");
  if (bytes.includes(0)) return { kind: "skipped", reason: "binary" };
  try {
    // Retain BOMs and line endings so later parsers can preserve original offsets.
    return { kind: "text", text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) };
  } catch { return { kind: "skipped", reason: "invalid-utf8" }; }
}
