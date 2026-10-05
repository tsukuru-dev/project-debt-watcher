import type { AgeCategory } from "../ages.js";
import type { CodeFinding, CodeReportView, CombinedReportView, ReportFinding, UnscannedFile } from "../types.js";
import type { AuthorSummary, TypeSummary } from "../summaries.js";
import type { BranchTipFinding } from "../../scanners/branches.js";
import { authorIdentity, type DetailedGroup } from "../grouping.js";

export interface TerminalReportOptions {
  /** The caller supplies a URL for the exact committed source. Omit when unavailable. */
  sourceLink?: (finding: CodeFinding) => string | undefined;
  commitLink?: (finding: BranchTipFinding) => string | undefined;
}

type ReportView = Pick<CodeReportView, "generatedAt" | "branches" | "filters" | "order">;

function reportHeader(view: ReportView, title: string, mode: string): string[] {
  const filters = [
    ...(view.filters.type ? [`type=${view.filters.type.join(",")}`] : []),
    ...(view.filters.author ? [`author=${plain(view.filters.author)}`] : []),
    `includefresh=${view.filters.includeFresh}`,
  ];
  return [title, `Generated: ${view.generatedAt}`,
    `Branches scanned: ${view.branches.length ? view.branches.map((branch) =>
      `${branch.scope}/${plain(branch.name)}`).join(", ") : "(none)"}`,
    mode, `Filters: ${filters.join(" · ")}`, `Order: ${view.order}`];
}

function oldestLine(entry: ReportFinding | undefined, author?: string): string {
  if (!entry) return "Oldest: none";
  const prefix = author ? `${plain(author)} · ` : "";
  if (entry.kind === "code") {
    const finding = entry.finding;
    return `Oldest: ${prefix}CODE · ${ageLabel(finding.ageDays)} · ${plain(finding.primary.marker)}`
      + ` · ${description(finding)} · ${location(finding)}`;
  }
  const finding = entry.finding;
  return `Oldest: ${prefix}BRANCH · ${ageLabel(finding.ageDays)} · ${plain(finding.branch.name)}`
    + ` · ${finding.branch.commitId.slice(0, 10)}`;
}

function authorOfOldest(entry: ReportFinding | undefined, groups: readonly { label: string;
  findings: ReportFinding[] }[]): string | undefined {
  return groups.find((group) => group.findings.some((item) =>
    item.kind === entry?.kind && item.finding === entry.finding))?.label;
}

function summaryOldestEntry(summary: TypeSummary | AuthorSummary): ReportFinding | undefined {
  return summary.oldest && summary.oldestKind
    ? { kind: summary.oldestKind, finding: summary.oldest } as ReportFinding : undefined;
}

function summaryOldestAuthor(summary: AuthorSummary): string | undefined {
  const entry = summaryOldestEntry(summary);
  if (!entry) return undefined;
  const author = entry.kind === "code"
    ? authorIdentity(entry.finding.primary.attribution.authorName,
      entry.finding.primary.attribution.authorEmail, "code")
    : authorIdentity(entry.finding.authorName, entry.finding.authorEmail, "branches");
  return summary.groups.find((group) => group.identity === author.identity)?.label ?? author.label;
}

const AGE_ICONS: Record<AgeCategory, string> = {
  fresh: "🌱", ageing: "💀", buried: "🪦", fossil: "🦖",
};

const DIVIDER = "─".repeat(48);

function section(title: string, count?: number): string[] {
  const heading = plain(title).toUpperCase();
  const label = count === undefined ? heading : heading.padEnd(Math.max(heading.length + 2,
    DIVIDER.length - String(count).length)) + count;
  return ["", label, DIVIDER];
}

function ageLabel(days: number): string {
  return `${days.toLocaleString("en-US")}d`;
}

function ageWidth(findings: readonly { ageDays: number }[]): number {
  return Math.max(4, ...findings.map((finding) => ageLabel(finding.ageDays).length));
}

function boardRow(category: AgeCategory, ageDays: number, label: string, detail: string,
  metadata: string[], width: number, labelWidth: number, detailWidth: number): string {
  const main = `${AGE_ICONS[category]}  ${ageLabel(ageDays).padStart(width)}  ${plain(label).padEnd(labelWidth)}`
    + (detailWidth ? `  ${plain(detail).padEnd(detailWidth)}` : "");
  return metadata.length ? `${main}  ·  ${metadata.join("  ·  ")}` : main.trimEnd();
}

function boardFooter(view: CombinedReportView, lines: string[], closingLine?: string,
  oldestAuthor?: string): void {
  lines.push("", `TOTAL : ${view.counts.total}`, "",
    `CODE : ${view.counts.code}  ·  BRANCHES : ${view.counts.branches}`,
    `AGES  🌱 ${view.counts.categories.fresh}  💀 ${view.counts.categories.ageing}`
      + `  🪦 ${view.counts.categories.buried}  🦖 ${view.counts.categories.fossil}`, "",
    oldestLine(view.oldest, oldestAuthor));
  if (view.unscanned.length) {
    lines.push(`Unscanned files (${view.unscanned.length}); debt in these files is unknown:`);
    for (const file of view.unscanned) {
      lines.push(`- ${plain(file.branch.name)}:${plain(file.file.path)} — ${unscannedReason(file)}`);
    }
  }
  if (closingLine) lines.push("", closingLine);
}

/** Git filenames and comment text can contain terminal controls; keep report output inert. */
function plain(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ").replace(/\s+/gu, " ").trim();
}

function location(finding: CodeFinding): string {
  return `${plain(finding.branch.name)}:${plain(finding.file.path)}:${finding.primary.line}`;
}

function hyperlink(label: string, target: string | undefined): string {
  if (target === undefined) return label;
  let url: URL;
  try { url = new URL(target); }
  catch { return label; }
  if (!["https:", "http:", "file:", "vscode:"].includes(url.protocol)
    || /[\u0000-\u001f\u007f-\u009f]/u.test(target)) return label;
  return `\u001b]8;;${url.href}\u0007${label}\u001b]8;;\u0007`;
}

function description(finding: CodeFinding): string {
  let text = plain(finding.comment.text).replace(/^\*\s*/u, "");
  if (text.startsWith(finding.primary.marker)) {
    text = text.slice(finding.primary.marker.length).replace(/^[\s:–—-]+/u, "").trim();
  }
  return text || "(no description)";
}

function unscannedReason(file: UnscannedFile): string {
  if (file.status !== "skipped") {
    return `${file.status}: ${plain(file.diagnostic.message)} (line ${file.diagnostic.position.line})`;
  }
  switch (file.reason) {
    case "too-large": return "file exceeds the scan size limit";
    case "binary": return "binary file";
    case "invalid-utf8": return "source is not valid UTF-8";
  }
}

/** Retained code-only renderer for callers that use a code view directly. */
export function renderCodeReportTerminal(view: CodeReportView, options: TerminalReportOptions = {}): string {
  const lines = [...reportHeader(view, "Graveyard — code comments", "Group: type"),
    `Code comments (${view.counts.code})`,
    `Fresh ${view.counts.categories.fresh} | Ageing ${view.counts.categories.ageing}`
      + ` | Buried ${view.counts.categories.buried} | Fossil ${view.counts.categories.fossil}`];

  if (!view.findings.length) lines.push("No matching code comments found.");
  for (const finding of view.findings) {
    const reference = hyperlink(location(finding), options.sourceLink?.(finding));
    lines.push(`${AGE_ICONS[finding.category]} | ${finding.ageDays} days | `
      + `${plain(finding.primary.marker)} | ${reference} | ${description(finding)}`
      + (view.settings.showAuthors ? ` | ${plain(finding.primary.attribution.authorName) || "Unknown"}` : ""));
  }

  lines.push(oldestLine(view.oldest ? { kind: "code", finding: view.oldest } : undefined));
  if (view.unscanned.length) {
    lines.push(`Unscanned files (${view.unscanned.length}); debt in these files is unknown:`);
    for (const file of view.unscanned) {
      lines.push(`- ${plain(file.branch.name)}:${plain(file.file.path)} — ${unscannedReason(file)}`);
    }
  }
  return lines.join("\n") + "\n";
}

/** Detailed report with code and branch sections, using the same filtered totals. */
export function renderCombinedReportTerminal(view: CombinedReportView, options: TerminalReportOptions = {},
  closingLine?: string): string {
  const lines = [...reportHeader(view, "🪦  PROJECT GRAVEYARD", "Group: type"),
    ...section("CODE DEBT", view.counts.code)];
  const width = ageWidth([...view.findings, ...view.branchFindings]);
  const markerWidth = Math.max(4, ...view.findings.map((finding) => plain(finding.primary.marker).length));
  const descriptionWidth = Math.min(48, Math.max(0, ...view.findings.map((finding) => description(finding).length)));
  if (!view.findings.length) lines.push("No matching code debt found.");
  for (const finding of view.findings) {
    lines.push(boardRow(finding.category, finding.ageDays, finding.primary.marker, description(finding),
      [hyperlink(location(finding), options.sourceLink?.(finding)),
        ...(view.settings.showAuthors ? [plain(finding.primary.attribution.authorName) || "Unknown"] : [])],
      width, markerWidth, descriptionWidth));
  }
  lines.push(...section("STALE BRANCHES", view.counts.branches));
  if (!view.branchFindings.length) lines.push("No matching stale branches found.");
  const branchWidth = Math.min(40, Math.max(0, ...view.branchFindings.map((finding) => plain(finding.branch.name).length)));
  for (const finding of view.branchFindings) {
    lines.push(boardRow(finding.category, finding.ageDays, finding.branch.name, "",
      [hyperlink(finding.branch.commitId.slice(0, 10), options.commitLink?.(finding)),
        ...(view.settings.showAuthors ? [plain(finding.authorName) || "Unknown"] : [])],
      width, branchWidth, 0));
  }
  boardFooter(view, lines, closingLine);
  return lines.join("\n") + "\n";
}

/** A detailed report with code and branch rows together under each selected group. */
export function renderGroupedReportTerminal(view: CombinedReportView, groups: DetailedGroup[],
  mode: "author" | "age", options: TerminalReportOptions = {}, closingLine?: string): string {
  const lines = reportHeader(view, `🪦  PROJECT GRAVEYARD — BY ${mode.toUpperCase()}`, `Group: ${mode}`);
  const width = ageWidth([...view.findings, ...view.branchFindings]);
  if (!groups.length) lines.push("No matching findings found.");
  for (const group of groups) {
    const label = mode === "age" ? group.label[0]!.toUpperCase() + group.label.slice(1) : group.label;
    lines.push(...section(`${label} (${group.findings.length})`));
    const labelWidth = Math.min(40, Math.max(0, ...group.findings.map((entry) => entry.kind === "code"
      ? `CODE ${plain(entry.finding.primary.marker)}`.length
      : `BRANCH ${plain(entry.finding.branch.name)}`.length)));
    const detailWidth = Math.min(48, Math.max(0, ...group.findings.map((entry) =>
      entry.kind === "code" ? description(entry.finding).length : 0)));
    for (const entry of group.findings) {
      if (entry.kind === "code") {
        const finding = entry.finding;
        lines.push(boardRow(finding.category, finding.ageDays, `CODE ${finding.primary.marker}`,
          description(finding), [hyperlink(location(finding), options.sourceLink?.(finding)),
            ...(mode === "age" && view.settings.showAuthors
              ? [plain(finding.primary.attribution.authorName) || "Unknown"] : [])],
          width, labelWidth, detailWidth));
      } else {
        const finding = entry.finding;
        lines.push(boardRow(finding.category, finding.ageDays, `BRANCH ${finding.branch.name}`, "",
          [hyperlink(finding.branch.commitId.slice(0, 10), options.commitLink?.(finding)),
            ...(mode === "age" && view.settings.showAuthors ? [plain(finding.authorName) || "Unknown"] : [])],
          width, labelWidth, detailWidth));
      }
    }
  }
  boardFooter(view, lines, closingLine, mode === "author" ? authorOfOldest(view.oldest, groups) : undefined);
  return lines.join("\n") + "\n";
}

/** Compact type counts for the same filtered findings; no individual rows. */
export function renderTypeSummaryTerminal(summary: TypeSummary, closingLine?: string): string {
  const lines = [...reportHeader(summary, "🪦  PROJECT GRAVEYARD", "Summary: type"),
    ...section("SUMMARY BY TYPE"),
    `CODE DEBT       ${summary.counts.code}`,
    `STALE BRANCHES  ${summary.counts.branches}`,
    `TOTAL           ${summary.counts.total}`, "",
    `AGES  🌱 ${summary.counts.categories.fresh}  💀 ${summary.counts.categories.ageing}`
      + `  🪦 ${summary.counts.categories.buried}  🦖 ${summary.counts.categories.fossil}`,
    oldestLine(summaryOldestEntry(summary))];
  if (summary.unscannedCount) lines.push(`Unscanned files: ${summary.unscannedCount}; debt in these files is unknown.`);
  if (closingLine) lines.push("", closingLine);
  return lines.join("\n") + "\n";
}

export function renderAuthorSummaryTerminal(summary: AuthorSummary, closingLine?: string): string {
  const lines = [...reportHeader(summary, "🪦  PROJECT GRAVEYARD", "Summary: author"),
    ...section("SUMMARY BY AUTHOR")];
  if (!summary.groups.length) lines.push("(none)");
  const labelWidth = Math.max(6, ...summary.groups.map((group) => group.label.length
    + (group.codeCount === 0 && group.branchCount > 0 && group.identity !== "unknown" ? " (branches)".length : 0)));
  for (const group of summary.groups) {
    const label = plain(group.label) + (group.codeCount === 0 && group.branchCount > 0 && group.identity !== "unknown" ? " (branches)" : "");
    const place = group.kind === "code" ? location(group.oldest as CodeFinding)
      : plain((group.oldest as BranchTipFinding).branch.name);
    lines.push(`${label.padEnd(labelWidth)}  ${String(group.count).padStart(3)}  ·  oldest ${ageLabel(group.oldest.ageDays)}  ·  ${place}`);
  }
  lines.push("", `TOTAL ${summary.total}`,
    oldestLine(summaryOldestEntry(summary), summaryOldestAuthor(summary)));
  if (summary.unscannedCount) lines.push(`Unscanned files: ${summary.unscannedCount}; debt in these files is unknown.`);
  if (closingLine) lines.push("", closingLine);
  return lines.join("\n") + "\n";
}
