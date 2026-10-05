import { assertObjectId, type BranchSnapshot } from "../git/branches.js";
import { runGitBytes, type GitContext } from "../git/client.js";
import type { DebtFinderConfig } from "../config/types.js";
import { ageInDays, categoryForAge, resolveAgeThresholds,
  type AgeCategory, type AgeThresholds } from "../reports/ages.js";

export interface BranchTipFinding {
  branch: BranchSnapshot;
  authorName: string;
  authorEmail: string;
  /** Git author time can predate the update to this branch. */
  authoredAt: string;
  /** Git committer time measures the last update represented by this commit. */
  committedAt: string;
  ageDays: number;
  category: AgeCategory;
}

export interface BranchTipScan {
  generatedAt: string;
  thresholds: AgeThresholds;
  findings: BranchTipFinding[];
}

interface CommitTip {
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  committedAt: string;
}

function identity(header: string | undefined, kind: string): { name: string; email: string; date: string } {
  const match = /^(.*) <([^<>]*)> (-?\d+) ([+-]\d{4})$/u.exec(header ?? "");
  if (!match) throw new Error(`Invalid ${kind} identity in Git commit.`);
  const seconds = Number(match[3]);
  if (!Number.isSafeInteger(seconds)) throw new Error(`Invalid ${kind} timestamp in Git commit.`);
  const date = new Date(seconds * 1000);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid ${kind} timestamp in Git commit.`);
  return { name: match[1]!, email: match[2]!, date: date.toISOString() };
}

/** Read author and committer headers from the exact commit object, not a moving ref. */
async function readCommitTip(commitId: string, context: GitContext): Promise<CommitTip> {
  assertObjectId(commitId);
  const bytes = await runGitBytes(["--no-lazy-fetch", "--no-replace-objects", "cat-file", "commit", commitId],
    context, 1024 * 1024);
  const separator = bytes.indexOf("\n\n");
  if (separator < 0) throw new Error(`Git commit has no header boundary: ${commitId}.`);
  const headers = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, separator));
  let author: string | undefined, committer: string | undefined;
  for (const line of headers.split("\n")) {
    if (line.startsWith("author ")) {
      if (author !== undefined) throw new Error(`Git commit has duplicate author headers: ${commitId}.`);
      author = line.slice(7);
    } else if (line.startsWith("committer ")) {
      if (committer !== undefined) throw new Error(`Git commit has duplicate committer headers: ${commitId}.`);
      committer = line.slice(10);
    }
  }
  const from = identity(author, "author"), update = identity(committer, "committer");
  return { authorName: from.name, authorEmail: from.email,
    authoredAt: from.date, committedAt: update.date };
}

/** Collect last-commit facts for selected refs without fetching or changing the checkout. */
export async function scanBranchTips(context: GitContext, branches: readonly BranchSnapshot[],
  config: DebtFinderConfig, asOf: Date = new Date()): Promise<BranchTipScan> {
  if (!Number.isFinite(asOf.getTime())) throw new Error("Branch scan date is invalid.");
  const commits = new Map<string, CommitTip>();
  const aged: Array<Omit<BranchTipFinding, "category">> = [];
  for (const branch of branches) {
    assertObjectId(branch.commitId);
    let tip = commits.get(branch.commitId);
    if (!tip) {
      tip = await readCommitTip(branch.commitId, context);
      commits.set(branch.commitId, tip);
    }
    aged.push({ branch, ...tip, ageDays: ageInDays(tip.committedAt, asOf) });
  }
  const oldest = aged.reduce((age, finding) => Math.max(age, finding.ageDays), 0);
  const thresholds = resolveAgeThresholds(config, oldest);
  return { generatedAt: asOf.toISOString(), thresholds,
    findings: aged.map((finding) => ({ ...finding,
      category: categoryForAge(finding.ageDays, thresholds) })) };
}
