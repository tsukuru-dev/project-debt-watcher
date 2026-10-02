import { assertObjectId } from "./branches.js";
import type { BranchSnapshot } from "./branches.js";
import { runGitBytes, type GitContext } from "./client.js";
import type { CommittedSourceFile } from "./files.js";
import type { MarkedComment, MarkerOccurrence } from "../scanners/comments/markers.js";

export interface CommentAttribution {
  commitId: string;
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  summary: string;
}

export interface BlamedMarker extends MarkerOccurrence {
  /** One-based line number in the committed blob, using Git's LF line boundaries. */
  line: number;
  attribution: CommentAttribution;
}

export interface BlamedComment extends Omit<MarkedComment, "matches"> {
  matches: BlamedMarker[];
}

function parseBlame(output: Buffer, expectedLine: number): CommentAttribution {
  const lines = new TextDecoder("utf-8", { fatal: true }).decode(output).split("\n");
  const header = /^(\^?[a-f0-9]{40}|\^?[a-f0-9]{64}) (\d+) (\d+)(?: (\d+))?$/u.exec(lines[0]!.replace(/\r$/u, ""));
  if (!header || Number(header[3]) !== expectedLine || (header[4] !== undefined && Number(header[4]) !== 1)) {
    throw new Error(`Unexpected Git blame header for line ${expectedLine}.`);
  }
  const commitId = header[1]!.replace(/^\^/u, "");
  assertObjectId(commitId);
  const fields = new Map<string, string>();
  let sawContent = false;
  for (const line of lines.slice(1)) {
    if (line.startsWith("\t")) { sawContent = true; break; }
    const space = line.indexOf(" ");
    if (space > 0) fields.set(line.slice(0, space), line.slice(space + 1).replace(/\r$/u, ""));
  }
  const name = fields.get("author"), mail = fields.get("author-mail"), time = fields.get("author-time"),
    summary = fields.get("summary");
  const seconds = Number(time);
  if (!sawContent || name === undefined || mail === undefined || !/^<[^<>]*>$/u.test(mail)
    || time === undefined || !/^-?\d+$/u.test(time) || !Number.isSafeInteger(seconds)
    || summary === undefined) throw new Error(`Incomplete Git blame metadata for line ${expectedLine}.`);
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid Git blame date for line ${expectedLine}.`);
  return { commitId, authorName: name, authorEmail: mail.slice(1, -1),
    authoredAt: date.toISOString(), summary };
}

function sourceLines(source: string): number[] {
  const starts = [0];
  for (let offset = 0; offset < source.length; offset++) {
    if (source[offset] === "\n") starts.push(offset + 1);
  }
  return starts;
}

function lineForOffset(starts: readonly number[], offset: number): number {
  let low = 0, high = starts.length;
  while (low + 1 < high) {
    const mid = Math.floor((low + high) / 2);
    if (starts[mid]! <= offset) low = mid; else high = mid;
  }
  return low + 1;
}

/** Blame the marker lines from the same immutable commit used for comment extraction. */
export async function blameCommentFindings(context: GitContext, branch: BranchSnapshot,
  file: CommittedSourceFile, source: string, findings: readonly MarkedComment[]): Promise<BlamedComment[]> {
  assertObjectId(branch.commitId);
  if (!findings.length) return [];
  const starts = sourceLines(source);
  const cache = new Map<number, CommentAttribution>();
  const blamed: BlamedComment[] = [];
  for (const finding of findings) {
    const matches: BlamedMarker[] = [];
    for (const match of finding.matches) {
      if (match.startOffset < 0 || match.endOffset > source.length || match.endOffset <= match.startOffset
        || source.slice(match.startOffset, match.endOffset) !== match.marker) {
        throw new Error(`Marker span is outside committed source: ${file.path}.`);
      }
      const line = lineForOffset(starts, match.startOffset);
      let attribution = cache.get(line);
      if (!attribution) {
        const output = await runGitBytes(["--no-lazy-fetch", "--no-replace-objects", "blame", "--line-porcelain",
          "--root", "-L", `${line},${line}`, branch.commitId, "--", file.path], context, 16 * 1024 * 1024);
        attribution = parseBlame(output, line);
        cache.set(line, attribution);
      }
      matches.push({ ...match, line, attribution });
    }
    blamed.push({ comment: finding.comment, matches });
  }
  return blamed;
}
