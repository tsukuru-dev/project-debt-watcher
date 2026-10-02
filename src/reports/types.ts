import type { BranchSnapshot } from "../git/branches.js";
import type { CommittedSourceFile } from "../git/files.js";
import type { BlamedMarker } from "../git/blame.js";
import type { SourceComment, SourcePosition } from "../scanners/comments/types.js";
import type { CommentScanResult } from "../scanners/comments/scan.js";
import type { DebtWatcherConfig } from "../config/types.js";
import type { AgeCategory, AgeThresholds } from "./ages.js";
import type { ReportFilters } from "../commands/arguments.js";

/** A flagged source comment is one finding, even when it contains several markers. */
export interface CodeFinding {
  branch: BranchSnapshot;
  file: CommittedSourceFile;
  comment: SourceComment;
  matches: BlamedMarker[];
  /** Oldest matched line supplies the finding's age and primary author. */
  primary: BlamedMarker;
  ageDays: number;
  category: AgeCategory;
}

export type UnscannedFile =
  | { branch: BranchSnapshot; file: CommittedSourceFile; status: "skipped";
    reason: "too-large" | "binary" | "invalid-utf8" }
  | { branch: BranchSnapshot; file: CommittedSourceFile; status: "invalid" | "unsupported";
    diagnostic: { message: string; position: SourcePosition } };

/** Pre-filter code findings; display categories, totals and export views are added later. */
export interface CodeFindingsSnapshot {
  generatedAt: string;
  branches: BranchSnapshot[];
  backends: CommentScanResult["backends"];
  settings: DebtWatcherConfig;
  thresholds: AgeThresholds;
  findings: CodeFinding[];
  unscanned: UnscannedFile[];
  oldest: CodeFinding | undefined;
}

/** The selected code-only view; totals and oldest describe only the matching findings. */
export interface CodeReportView {
  generatedAt: string;
  branches: BranchSnapshot[];
  backends: CommentScanResult["backends"];
  settings: DebtWatcherConfig;
  thresholds: AgeThresholds;
  filters: ReportFilters & { includeFresh: boolean };
  order: "oldnew" | "newold";
  findings: CodeFinding[];
  unscanned: UnscannedFile[];
  counts: { total: number; code: number; categories: Record<AgeCategory, number> };
  oldest: CodeFinding | undefined;
}
