import type { AgeCategory } from "./ages.js";
import type { CodeFinding, CodeReportView } from "./types.js";
import { compareCodeFindings } from "./ordering.js";

/** The type summary shares the detailed report's selected findings and totals. */
export interface TypeSummary {
  generatedAt: string;
  branchCount: number;
  counts: { total: number; code: number; categories: Record<AgeCategory, number> };
  oldest: CodeFinding | undefined;
  unscannedCount: number;
}

export function buildTypeSummary(view: CodeReportView): TypeSummary {
  return { generatedAt: view.generatedAt, branchCount: view.branches.length,
    counts: { total: view.counts.total, code: view.counts.code,
      categories: { ...view.counts.categories } },
    oldest: view.oldest, unscannedCount: view.unscanned.length };
}

export interface AuthorGroup {
  identity: string;
  label: string;
  count: number;
  oldest: CodeFinding;
}

export interface AuthorSummary {
  generatedAt: string;
  branchCount: number;
  total: number;
  groups: AuthorGroup[];
  oldest: CodeFinding | undefined;
  unscannedCount: number;
}

/** Group only selected findings; an explicit blame summary reveals labels even when detailed rows hide them. */
export function buildAuthorSummary(view: CodeReportView): AuthorSummary {
  const groups = new Map<string, AuthorGroup>();
  for (const finding of view.findings) {
    const { authorName, authorEmail } = finding.primary.attribution;
    const name = authorName.trim(), email = authorEmail.trim();
    const identity = email ? `code:email:${email.toLowerCase()}`
      : name ? `code:name:${name.toLowerCase()}` : "unknown";
    const label = email ? (name ? `${name} <${email}>` : email) : name || "Unknown";
    const existing = groups.get(identity);
    if (!existing) groups.set(identity, { identity, label, count: 1, oldest: finding });
    else {
      existing.count++;
      if (compareCodeFindings(finding, existing.oldest) < 0) existing.oldest = finding;
      if (label.localeCompare(existing.label) < 0) existing.label = label;
    }
  }
  const direction = view.order === "oldnew" ? 1 : -1;
  const ordered = [...groups.values()].sort((a, b) => {
    const byAge = a.oldest.primary.attribution.authoredAt.localeCompare(b.oldest.primary.attribution.authoredAt);
    return byAge * direction || a.label.localeCompare(b.label) || a.identity.localeCompare(b.identity);
  });
  return { generatedAt: view.generatedAt, branchCount: view.branches.length,
    total: view.counts.total, groups: ordered, oldest: view.oldest,
    unscannedCount: view.unscanned.length };
}
