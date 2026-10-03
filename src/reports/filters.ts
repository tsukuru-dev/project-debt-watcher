import type { ReportFilters } from "../commands/arguments.js";
import type { AgeCategory } from "./ages.js";
import { orderCodeFindings } from "./ordering.js";
import { categoryForAge, resolveAgeThresholds } from "./ages.js";
import type { BranchTipScan, BranchTipFinding } from "../scanners/branches.js";
import type { CodeFinding, CodeFindingsSnapshot, CodeReportView, CombinedReportView, ReportFinding } from "./types.js";

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

function orderBranchFindings(findings: readonly BranchTipFinding[], direction: "oldnew" | "newold"): BranchTipFinding[] {
  return [...findings].sort((a, b) => {
    const age = a.committedAt.localeCompare(b.committedAt);
    return (direction === "oldnew" ? age : -age) || a.branch.ref.localeCompare(b.branch.ref);
  });
}

function oldestReportFinding(code: readonly CodeFinding[], branches: readonly BranchTipFinding[]): ReportFinding | undefined {
  const oldestCode = orderCodeFindings(code, "oldnew")[0];
  const oldestBranch = orderBranchFindings(branches, "oldnew")[0];
  if (!oldestCode) return oldestBranch ? { kind: "branches", finding: oldestBranch } : undefined;
  if (!oldestBranch || oldestCode.primary.attribution.authoredAt <= oldestBranch.committedAt) {
    return { kind: "code", finding: oldestCode };
  }
  return { kind: "branches", finding: oldestBranch };
}

/** Reclassify against the oldest item across debt types before applying report filters. */
export function buildCombinedReportView(snapshot: CodeFindingsSnapshot, branchScan: BranchTipScan,
  options: CodeViewOptions = {}): CombinedReportView {
  const filter = options.filter ?? {};
  if (filter.type !== undefined && (filter.type.length === 0 || filter.type.includes("issues"))) {
    throw new Error("Only code and branches are available until issue scanning is implemented.");
  }
  if (filter.author !== undefined && !filter.author.trim()) throw new Error("Author filter must not be empty.");
  const includeFresh = filter.includeFresh ?? snapshot.settings.includeFresh;
  if (typeof includeFresh !== "boolean") throw new Error("includefresh must be true or false.");
  const order = options.order ?? snapshot.settings.order;
  const oldestAge = Math.max(snapshot.findings.reduce((age, finding) => Math.max(age, finding.ageDays), 0),
    branchScan.findings.reduce((age, finding) => Math.max(age, finding.ageDays), 0));
  const thresholds = resolveAgeThresholds(snapshot.settings, oldestAge);
  const code = snapshot.findings.map((finding) => ({ ...finding,
    category: categoryForAge(finding.ageDays, thresholds) }));
  const branches = branchScan.findings.map((finding) => ({ ...finding,
    category: categoryForAge(finding.ageDays, thresholds) }));
  const author = filter.author?.trim().toLowerCase();
  const selectedCode = filter.type?.includes("branches") && !filter.type.includes("code") ? []
    : code.filter((finding) => (includeFresh || finding.category !== "fresh")
      && (author === undefined || matchesAuthor(finding, author)));
  const selectedBranches = filter.type?.includes("code") && !filter.type.includes("branches") ? []
    : branches.filter((finding) => (includeFresh || finding.category !== "fresh")
      && (author === undefined || finding.authorName.toLowerCase().includes(author)
        || finding.authorEmail.toLowerCase().includes(author)));
  const findings = orderCodeFindings(selectedCode, order);
  const branchFindings = orderBranchFindings(selectedBranches, order);
  const categories: Record<AgeCategory, number> = { fresh: 0, ageing: 0, buried: 0, fossil: 0 };
  for (const finding of [...findings, ...branchFindings]) categories[finding.category]++;
  return { generatedAt: snapshot.generatedAt, branches: snapshot.branches,
    backends: snapshot.backends, settings: snapshot.settings, thresholds,
    filters: { ...filter, includeFresh }, order, findings, branchFindings,
    unscanned: snapshot.unscanned,
    counts: { total: findings.length + branchFindings.length,
      code: findings.length, branches: branchFindings.length, categories },
    oldest: oldestReportFinding(findings, branchFindings) };
}
