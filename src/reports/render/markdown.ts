import type { CodeFinding, CodeReportView, CombinedReportView, ReportFinding, UnscannedFile } from "../types.js";
import type { BranchTipFinding } from "../../scanners/branches.js";
import type { AuthorSummary, TypeSummary } from "../summaries.js";
import type { DetailedGroup } from "../grouping.js";
import { authorIdentity } from "../grouping.js";

type ReportMetadata = Pick<CodeReportView, "generatedAt" | "branches" | "filters" | "order">;

function reportMetadata(view: ReportMetadata, context: { checkoutBranch: string | null;
  checkoutCommit: string | null; scope: "local" | "remote" }, mode: string): string[] {
  const filters = [
    ...(view.filters.type ? [`type=${view.filters.type.join(",")}`] : []),
    ...(view.filters.author ? [`author=${safe(view.filters.author)}`] : []),
    `includefresh=${view.filters.includeFresh}`,
  ];
  return [`Generated: ${safe(view.generatedAt)}`,
    `Branches scanned: ${view.branches.length ? view.branches.map((branch) =>
      `${branch.scope}/${safe(branch.name)}`).join(", ") : "(none)"}`,
    mode, `Filters: ${filters.join(" · ")}`, `Order: ${view.order}`,
    `Generating checkout: ${safe(context.checkoutBranch ?? "detached HEAD")}`
      + (context.checkoutCommit ? ` (${safe(context.checkoutCommit)})` : " (no commit)"),
    `Scope: ${context.scope}`];
}

function oldestDetail(entry: ReportFinding | undefined, author?: string): string {
  if (!entry) return "None";
  const prefix = author ? `${safe(author)} · ` : "";
  if (entry.kind === "code") {
    const finding = entry.finding;
    let detail = finding.comment.text.trim().replace(/^\*\s*/u, "");
    if (detail.startsWith(finding.primary.marker)) {
      detail = detail.slice(finding.primary.marker.length).replace(/^[\s:–—-]+/u, "").trim();
    }
    return `${prefix}CODE · ${finding.ageDays} days · ${safe(finding.primary.marker)}`
      + ` · ${safe(detail) || "(no description)"} · ${place(finding)}`;
  }
  return `${prefix}BRANCH · ${entry.finding.ageDays} days · ${safe(entry.finding.branch.name)}`
    + ` · ${safe(entry.finding.branch.commitId.slice(0, 10))}`;
}

function summaryOldest(summary: TypeSummary | AuthorSummary): ReportFinding | undefined {
  return summary.oldest && summary.oldestKind
    ? { kind: summary.oldestKind, finding: summary.oldest } as ReportFinding : undefined;
}

const AGE_ICONS = { fresh: "🌱", ageing: "💀", buried: "🪦", fossil: "🦖" } as const;

function safe(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ").replace(/\s+/gu, " ").trim()
    .replaceAll("\\", "\\\\").replaceAll("|", "\\|").replaceAll("`", "\\`")
    .replaceAll("[", "\\[").replaceAll("]", "\\]").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function place(finding: CodeFinding): string {
  return `${safe(finding.branch.name)}:${safe(finding.file.path)}:${finding.primary.line}`;
}

export interface MarkdownReportLinks {
  sourceLink?: (finding: CodeFinding) => string | undefined;
  commitLink?: (finding: BranchTipFinding) => string | undefined;
}

function linked(label: string, target: string | undefined): string {
  if (!target || /[\u0000-\u001f\u007f-\u009f]/u.test(target)) return label;
  try {
    const url = new URL(target);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return label;
    return `[${label}](${url.href.replaceAll("(", "%28").replaceAll(")", "%29")})`;
  } catch { return label; }
}

function reason(file: UnscannedFile): string {
  if (file.status !== "skipped") return `${file.status}: ${safe(file.diagnostic.message)}`;
  return file.reason;
}

/** A self-contained, UTF-8 export of the selected code-only view. */
export function renderCodeReportMarkdown(view: CodeReportView,
  context: { checkoutBranch: string | null; checkoutCommit: string | null; scope: "local" | "remote" }): string {
  const lines = ["# Graveyard — code comments", "",
    ...reportMetadata(view, context, "Group: type"), "",
    "## Summary", "", `Total debt: ${view.counts.total}`, `Code comments: ${view.counts.code}`,
    `Fresh: ${view.counts.categories.fresh} · Ageing: ${view.counts.categories.ageing}`
      + ` · Buried: ${view.counts.categories.buried} · Fossil: ${view.counts.categories.fossil}`,
    `Oldest: ${oldestDetail(view.oldest ? { kind: "code", finding: view.oldest } : undefined)}`, "",
    "## Code comments", ""];
  if (view.findings.length === 0) lines.push("No matching code comments found.", "");
  else {
    lines.push(view.settings.showAuthors
      ? "| Age | Days | Marker | Source | Comment | Author |"
      : "| Age | Days | Marker | Source | Comment |",
    view.settings.showAuthors ? "| --- | ---: | --- | --- | --- | --- |"
      : "| --- | ---: | --- | --- | --- |");
    for (const finding of view.findings) {
      const cells = [`${AGE_ICONS[finding.category]} ${safe(finding.category)}`, String(finding.ageDays), safe(finding.primary.marker),
        place(finding), safe(finding.comment.text) || "(no description)"];
      if (view.settings.showAuthors) cells.push(safe(finding.primary.attribution.authorName) || "Unknown");
      lines.push(`| ${cells.join(" | ")} |`);
    }
    lines.push("");
  }
  if (view.unscanned.length) {
    lines.push(`## Unscanned files (${view.unscanned.length})`, "",
      "Debt in these files is unknown.", "");
    for (const file of view.unscanned) lines.push(`- ${safe(file.branch.name)}:${safe(file.file.path)} — ${reason(file)}`);
    lines.push("");
  }
  return lines.join("\n") + "\n";
}

/** Export both detailed sections and their shared totals without terminal escapes. */
export function renderCombinedReportMarkdown(view: CombinedReportView,
  context: { checkoutBranch: string | null; checkoutCommit: string | null; scope: "local" | "remote" },
  links: MarkdownReportLinks = {}, closingLine?: string): string {
  const lines = ["# Graveyard — project debt", "",
    ...reportMetadata(view, context, "Group: type"), "",
    "## Summary", "", `Total debt: ${view.counts.total}`, `Code comments: ${view.counts.code}`,
    `Stale branches: ${view.counts.branches}`,
    `Fresh: ${view.counts.categories.fresh} · Ageing: ${view.counts.categories.ageing}`
      + ` · Buried: ${view.counts.categories.buried} · Fossil: ${view.counts.categories.fossil}`,
    `Oldest: ${oldestDetail(view.oldest)}`, "", "## Code comments", ""];
  if (!view.findings.length) lines.push("No matching code comments found.", "");
  else {
    lines.push(view.settings.showAuthors ? "| Age | Days | Marker | Source | Comment | Author |"
      : "| Age | Days | Marker | Source | Comment |",
    view.settings.showAuthors ? "| --- | ---: | --- | --- | --- | --- |" : "| --- | ---: | --- | --- | --- |");
    for (const finding of view.findings) {
      const cells = [`${AGE_ICONS[finding.category]} ${safe(finding.category)}`, String(finding.ageDays),
        safe(finding.primary.marker), linked(place(finding), links.sourceLink?.(finding)),
        safe(finding.comment.text) || "(no description)"];
      if (view.settings.showAuthors) cells.push(safe(finding.primary.attribution.authorName) || "Unknown");
      lines.push(`| ${cells.join(" | ")} |`);
    }
    lines.push("");
  }
  lines.push("## Stale branches", "");
  if (!view.branchFindings.length) lines.push("No matching stale branches found.", "");
  else {
    lines.push(view.settings.showAuthors ? "| Age | Days | Commit | Branch | Author |"
      : "| Age | Days | Commit | Branch |",
    view.settings.showAuthors ? "| --- | ---: | --- | --- | --- |" : "| --- | ---: | --- | --- |");
    for (const finding of view.branchFindings) {
      const cells = [`${AGE_ICONS[finding.category]} ${safe(finding.category)}`, String(finding.ageDays),
        linked(finding.branch.commitId, links.commitLink?.(finding)), safe(finding.branch.name)];
      if (view.settings.showAuthors) cells.push(safe(finding.authorName) || "Unknown");
      lines.push(`| ${cells.join(" | ")} |`);
    }
    lines.push("");
  }
  if (view.unscanned.length) {
    lines.push(`## Unscanned files (${view.unscanned.length})`, "", "Debt in these files is unknown.", "");
    for (const file of view.unscanned) lines.push(`- ${safe(file.branch.name)}:${safe(file.file.path)} — ${reason(file)}`);
    lines.push("");
  }
  if (closingLine) lines.push(`*${safe(closingLine)}*`, "");
  return lines.join("\n") + "\n";
}

export function renderGroupedReportMarkdown(view: CombinedReportView, groups: DetailedGroup[],
  mode: "author" | "age",
  context: { checkoutBranch: string | null; checkoutCommit: string | null; scope: "local" | "remote" },
  links: MarkdownReportLinks = {}, closingLine?: string): string {
  const lines = [`# Graveyard — project debt grouped by ${mode}`, "",
    ...reportMetadata(view, context, `Group: ${mode}`), "", "## Summary", "",
    `Total debt: ${view.counts.total}`, `Code comments: ${view.counts.code}`,
    `Stale branches: ${view.counts.branches}`,
    `Fresh: ${view.counts.categories.fresh} · Ageing: ${view.counts.categories.ageing}`
      + ` · Buried: ${view.counts.categories.buried} · Fossil: ${view.counts.categories.fossil}`,
    `Oldest: ${oldestDetail(view.oldest, mode === "author" ? groups.find((group) =>
      group.findings.some((entry) => entry.kind === view.oldest?.kind
        && entry.finding === view.oldest.finding))?.label : undefined)}`, ""];
  if (!groups.length) lines.push("No matching findings found.", "");
  for (const group of groups) {
    const label = mode === "age" ? group.label[0]!.toUpperCase() + group.label.slice(1) : group.label;
    lines.push(`## ${safe(label)} (${group.findings.length})`, "",
      mode === "age" && view.settings.showAuthors
        ? "| Age | Days | Type | Reference | Details | Author |"
        : "| Age | Days | Type | Reference | Details |",
      mode === "age" && view.settings.showAuthors
        ? "| --- | ---: | --- | --- | --- | --- |"
        : "| --- | ---: | --- | --- | --- |");
    for (const entry of group.findings) {
      if (entry.kind === "code") {
        const finding = entry.finding;
        const cells = [`${AGE_ICONS[finding.category]} ${safe(finding.category)}`, String(finding.ageDays), "Code",
          linked(safe(finding.primary.marker), links.sourceLink?.(finding)),
          `${place(finding)} · ${safe(finding.comment.text) || "(no description)"}`];
        if (mode === "age" && view.settings.showAuthors) cells.push(safe(finding.primary.attribution.authorName) || "Unknown");
        lines.push(`| ${cells.join(" | ")} |`);
      } else {
        const finding = entry.finding;
        const cells = [`${AGE_ICONS[finding.category]} ${safe(finding.category)}`, String(finding.ageDays), "Branch",
          linked(safe(finding.branch.commitId), links.commitLink?.(finding)), safe(finding.branch.name)];
        if (mode === "age" && view.settings.showAuthors) cells.push(safe(finding.authorName) || "Unknown");
        lines.push(`| ${cells.join(" | ")} |`);
      }
    }
    lines.push("");
  }
  if (view.unscanned.length) {
    lines.push(`## Unscanned files (${view.unscanned.length})`, "", "Debt in these files is unknown.", "");
    for (const file of view.unscanned) lines.push(`- ${safe(file.branch.name)}:${safe(file.file.path)} — ${reason(file)}`);
    lines.push("");
  }
  if (closingLine) lines.push(`*${safe(closingLine)}*`, "");
  return lines.join("\n") + "\n";
}

/** The saved type summary contains aggregate information, not detailed finding rows. */
export function renderTypeSummaryMarkdown(summary: TypeSummary,
  context: { checkoutBranch: string | null; checkoutCommit: string | null; scope: "local" | "remote" },
  closingLine?: string): string {
  const lines = ["# Graveyard — summary by type", "",
    ...reportMetadata(summary, context, "Summary: type"), "",
    "| Debt type | Count |", "| --- | ---: |", `| Code comments | ${summary.counts.code} |`,
    `| Stale branches | ${summary.counts.branches} |`, "",
    `Total debt: ${summary.counts.total}`, "",
    `Fresh: ${summary.counts.categories.fresh} · Ageing: ${summary.counts.categories.ageing}`
      + ` · Buried: ${summary.counts.categories.buried} · Fossil: ${summary.counts.categories.fossil}`,
    `Oldest: ${oldestDetail(summaryOldest(summary))}`];
  if (summary.unscannedCount) lines.push("", `Unscanned files: ${summary.unscannedCount}; debt in these files is unknown.`);
  if (closingLine) lines.push("", `*${safe(closingLine)}*`);
  return lines.join("\n") + "\n";
}

export function renderAuthorSummaryMarkdown(summary: AuthorSummary,
  context: { checkoutBranch: string | null; checkoutCommit: string | null; scope: "local" | "remote" },
  closingLine?: string): string {
  const lines = ["# Graveyard — summary by author", "",
    ...reportMetadata(summary, context, "Summary: author"), "",
    "| Author | Count | Oldest |", "| --- | ---: | --- |"];
  for (const group of summary.groups) {
    const label = safe(group.label) + (group.codeCount === 0 && group.branchCount > 0 && group.identity !== "unknown" ? " (branches)" : "");
    const location = group.kind === "code" ? place(group.oldest as CodeFinding)
      : safe((group.oldest as BranchTipFinding).branch.name);
    lines.push(`| ${label} | ${group.count} | ${group.oldest.ageDays} days · ${location} |`);
  }
  const oldest = summaryOldest(summary);
  const identity = oldest?.kind === "code"
    ? authorIdentity(oldest.finding.primary.attribution.authorName,
      oldest.finding.primary.attribution.authorEmail, "code").identity
    : oldest?.kind === "branches"
      ? authorIdentity(oldest.finding.authorName, oldest.finding.authorEmail, "branches").identity
      : undefined;
  lines.push("", `Total debt: ${summary.total}`, "",
    `Oldest: ${oldestDetail(oldest, summary.groups.find((group) => group.identity === identity)?.label)}`);
  if (summary.unscannedCount) lines.push("", `Unscanned files: ${summary.unscannedCount}; debt in these files is unknown.`);
  if (closingLine) lines.push("", `*${safe(closingLine)}*`);
  return lines.join("\n") + "\n";
}
