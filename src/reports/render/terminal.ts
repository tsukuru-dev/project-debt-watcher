import type { AgeCategory } from "../ages.js";
import type { CodeFinding, CodeReportView, UnscannedFile } from "../types.js";
import type { AuthorSummary, TypeSummary } from "../summaries.js";

export interface TerminalReportOptions {
  /** The caller supplies a URL for the exact committed source. Omit when unavailable. */
  sourceLink?: (finding: CodeFinding) => string | undefined;
}

const AGE_ICONS: Record<AgeCategory, string> = {
  fresh: "🌱", ageing: "💀", buried: "🪦", fossil: "🦖",
};

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
  if (!["https:", "http:", "file:"].includes(url.protocol)
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

/** Render the filtered code view only; branches and issues join the report in later chunks. */
export function renderCodeReportTerminal(view: CodeReportView, options: TerminalReportOptions = {}): string {
  const lines = ["Graveyard — code comments", `Generated: ${view.generatedAt}`,
    `Branches: ${view.branches.length ? view.branches.map((branch) =>
      `${branch.scope}/${plain(branch.name)}`).join(", ") : "(none)"}`,
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

  if (view.oldest) {
    lines.push(`Oldest code comment: ${view.oldest.ageDays} days | ${location(view.oldest)}`);
  }
  if (view.unscanned.length) {
    lines.push(`Unscanned files (${view.unscanned.length}); debt in these files is unknown:`);
    for (const file of view.unscanned) {
      lines.push(`- ${plain(file.branch.name)}:${plain(file.file.path)} — ${unscannedReason(file)}`);
    }
  }
  return lines.join("\n") + "\n";
}

/** Compact type counts for the same filtered findings; no individual rows. */
export function renderTypeSummaryTerminal(summary: TypeSummary): string {
  const lines = ["Graveyard — summary by type", `Generated: ${summary.generatedAt}`,
    `Scanned branches: ${summary.branchCount}`, `Total debt: ${summary.counts.total}`,
    `Code comments: ${summary.counts.code}`,
    `Fresh ${summary.counts.categories.fresh} | Ageing ${summary.counts.categories.ageing}`
      + ` | Buried ${summary.counts.categories.buried} | Fossil ${summary.counts.categories.fossil}`,
    summary.oldest ? `Oldest: code comment | ${summary.oldest.ageDays} days | ${location(summary.oldest)}`
      : "Oldest: none"];
  if (summary.unscannedCount) lines.push(`Unscanned files: ${summary.unscannedCount}; debt in these files is unknown.`);
  return lines.join("\n") + "\n";
}

export function renderAuthorSummaryTerminal(summary: AuthorSummary): string {
  const lines = ["Graveyard — summary by author", `Generated: ${summary.generatedAt}`,
    `Scanned branches: ${summary.branchCount}`, `Total debt: ${summary.total}`, "Authors:"];
  if (!summary.groups.length) lines.push("(none)");
  for (const group of summary.groups) {
    lines.push(`${plain(group.label)}: ${group.count} | oldest ${group.oldest.ageDays} days | ${location(group.oldest)}`);
  }
  lines.push(summary.oldest ? `Oldest: code comment | ${summary.oldest.ageDays} days | ${location(summary.oldest)}`
    : "Oldest: none");
  if (summary.unscannedCount) lines.push(`Unscanned files: ${summary.unscannedCount}; debt in these files is unknown.`);
  return lines.join("\n") + "\n";
}
