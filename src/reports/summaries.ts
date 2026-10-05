import type { AgeCategory } from "./ages.js";
import type { CodeFinding, CodeReportView, CombinedReportView } from "./types.js";
import type { BranchTipFinding } from "../scanners/branches.js";
import { compareCodeFindings } from "./ordering.js";
import { authorIdentity } from "./grouping.js";

/** The type summary shares the detailed report's selected findings and totals. */
export interface TypeSummary {
  generatedAt: string;
  branchCount: number;
  counts: { total: number; code: number; branches: number; categories: Record<AgeCategory, number> };
  oldest: CodeFinding | BranchTipFinding | undefined;
  oldestKind: "code" | "branches" | undefined;
  unscannedCount: number;
}

export function buildTypeSummary(view: CodeReportView | CombinedReportView): TypeSummary {
  const combined = "branchFindings" in view;
  return { generatedAt: view.generatedAt, branchCount: view.branches.length,
    counts: { total: view.counts.total, code: view.counts.code,
      branches: combined ? view.counts.branches : 0,
      categories: { ...view.counts.categories } },
    oldest: combined ? view.oldest?.finding : view.oldest,
    oldestKind: combined ? view.oldest?.kind : view.oldest ? "code" : undefined,
    unscannedCount: view.unscanned.length };
}

export interface AuthorGroup {
  identity: string;
  label: string;
  count: number;
  codeCount: number;
  branchCount: number;
  kind: "code" | "branches";
  oldest: CodeFinding | BranchTipFinding;
}

export interface AuthorSummary {
  generatedAt: string;
  branchCount: number;
  total: number;
  groups: AuthorGroup[];
  oldest: CodeFinding | BranchTipFinding | undefined;
  oldestKind: "code" | "branches" | undefined;
  unscannedCount: number;
}

/** Group only selected findings; an explicit blame summary reveals labels even when detailed rows hide them. */
function findingTime(finding: CodeFinding | BranchTipFinding, kind: "code" | "branches"): string {
  return kind === "code" ? (finding as CodeFinding).primary.attribution.authoredAt
    : (finding as BranchTipFinding).committedAt;
}

export function buildAuthorSummary(view: CodeReportView | CombinedReportView): AuthorSummary {
  const groups = new Map<string, AuthorGroup>();
  const add = (finding: CodeFinding | BranchTipFinding, kind: "code" | "branches",
    authorName: string, authorEmail: string): void => {
    const { identity, label } = authorIdentity(authorName, authorEmail, kind);
    const existing = groups.get(identity);
    if (!existing) groups.set(identity, { identity, label, count: 1,
      codeCount: kind === "code" ? 1 : 0, branchCount: kind === "branches" ? 1 : 0,
      kind, oldest: finding });
    else {
      existing.count++;
      if (kind === "code") existing.codeCount++;
      else existing.branchCount++;
      const age = findingTime(finding, kind).localeCompare(findingTime(existing.oldest, existing.kind));
      if (age < 0 || (age === 0 && kind === existing.kind && kind === "code"
        && compareCodeFindings(finding as CodeFinding, existing.oldest as CodeFinding) < 0)) {
        existing.oldest = finding;
        existing.kind = kind;
      }
      if (label.localeCompare(existing.label) < 0) existing.label = label;
    }
  };
  for (const finding of view.findings) {
    add(finding, "code", finding.primary.attribution.authorName, finding.primary.attribution.authorEmail);
  }
  if ("branchFindings" in view) {
    for (const finding of view.branchFindings) add(finding, "branches", finding.authorName, finding.authorEmail);
  }
  const direction = view.order === "oldnew" ? 1 : -1;
  const ordered = [...groups.values()].sort((a, b) => {
    const byAge = findingTime(a.oldest, a.kind).localeCompare(findingTime(b.oldest, b.kind));
    return byAge * direction || a.label.localeCompare(b.label) || a.identity.localeCompare(b.identity);
  });
  const combined = "branchFindings" in view;
  return { generatedAt: view.generatedAt, branchCount: view.branches.length,
    total: view.counts.total, groups: ordered,
    oldest: combined ? view.oldest?.finding : view.oldest,
    oldestKind: combined ? view.oldest?.kind : view.oldest ? "code" : undefined,
    unscannedCount: view.unscanned.length };
}
