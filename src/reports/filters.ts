import type { ReportFilters } from "../commands/arguments.js";
import type { AgeCategory } from "./ages.js";
import { orderCodeFindings } from "./ordering.js";
import type { CodeFinding, CodeFindingsSnapshot, CodeReportView } from "./types.js";

export interface CodeViewOptions {
  filter?: ReportFilters;
  order?: "oldnew" | "newold";
}

function matchesAuthor(finding: CodeFinding, query: string): boolean {
  const { authorName, authorEmail } = finding.primary.attribution;
  const needle = query.toLowerCase();
  return authorName.toLowerCase().includes(needle) || authorEmail.toLowerCase().includes(needle);
}

/** Filter the pre-filter snapshot once, then calculate every displayed total from that selection. */
export function buildCodeReportView(snapshot: CodeFindingsSnapshot, options: CodeViewOptions = {}): CodeReportView {
  const filter = options.filter ?? {};
  if (filter.type !== undefined && (filter.type.length === 0 || filter.type.some((type) => type !== "code"))) {
    throw new Error("Only type=code is available until branch and issue scanning are implemented.");
  }
  if (filter.author !== undefined && !filter.author.trim()) throw new Error("Author filter must not be empty.");
  const includeFresh = filter.includeFresh ?? snapshot.settings.includeFresh;
  if (typeof includeFresh !== "boolean") throw new Error("includefresh must be true or false.");
  const order = options.order ?? snapshot.settings.order;
  const selected = snapshot.findings.filter((finding) =>
    (includeFresh || finding.category !== "fresh")
    && (filter.author === undefined || matchesAuthor(finding, filter.author.trim())));
  const findings = orderCodeFindings(selected, order);
  const categories: Record<AgeCategory, number> = { fresh: 0, ageing: 0, buried: 0, fossil: 0 };
  for (const finding of findings) categories[finding.category]++;
  return {
    generatedAt: snapshot.generatedAt, branches: snapshot.branches, backends: snapshot.backends,
    settings: snapshot.settings, thresholds: snapshot.thresholds,
    filters: { ...filter, includeFresh }, order, findings, unscanned: snapshot.unscanned,
    counts: { total: findings.length, code: findings.length, categories },
    oldest: orderCodeFindings(selected, "oldnew")[0],
  };
}
