import type { AgeCategory } from "./ages.js";
import type { CodeFinding, CodeReportView } from "./types.js";

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
