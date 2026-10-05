import type { CodeFinding, CodeReportView, CombinedReportView, UnscannedFile } from "../types.js";
import type { BranchTipFinding } from "../../scanners/branches.js";
import type { AuthorSummary, TypeSummary } from "../summaries.js";
import type { DetailedGroup } from "../grouping.js";

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
  const lines = ["# Graveyard — code comments", "", `Generated: ${safe(view.generatedAt)}`,
    `Generating checkout: ${safe(context.checkoutBranch ?? "detached HEAD")}`
      + (context.checkoutCommit ? ` (${safe(context.checkoutCommit)})` : " (no commit)"),
    `Scope: ${context.scope}`,
    `Branches: ${view.branches.length ? view.branches.map((branch) =>
      `${branch.scope}/${safe(branch.name)}`).join(", ") : "(none)"}`, "",
    "## Summary", "", `Total debt: ${view.counts.total}`, `Code comments: ${view.counts.code}`,
    `Fresh: ${view.counts.categories.fresh} · Ageing: ${view.counts.categories.ageing}`
      + ` · Buried: ${view.counts.categories.buried} · Fossil: ${view.counts.categories.fossil}`,
    `Oldest: ${view.oldest ? `${view.oldest.ageDays} days · ${place(view.oldest)}` : "None"}`, "",
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
  const lines = ["# Graveyard — project debt", "", `Generated: ${safe(view.generatedAt)}`,
    `Generating checkout: ${safe(context.checkoutBranch ?? "detached HEAD")}`
      + (context.checkoutCommit ? ` (${safe(context.checkoutCommit)})` : " (no commit)"),
    `Scope: ${context.scope}`, `Scanned branches: ${view.branches.length}`, "",
    "## Summary", "", `Total debt: ${view.counts.total}`, `Code comments: ${view.counts.code}`,
    `Stale branches: ${view.counts.branches}`,
    `Fresh: ${view.counts.categories.fresh} · Ageing: ${view.counts.categories.ageing}`
      + ` · Buried: ${view.counts.categories.buried} · Fossil: ${view.counts.categories.fossil}`,
    `Oldest: ${view.oldest?.kind === "code" ? `code comment · ${view.oldest.finding.ageDays} days · ${place(view.oldest.finding)}`
      : view.oldest?.kind === "branches" ? `branch · ${view.oldest.finding.ageDays} days · ${safe(view.oldest.finding.branch.name)}`
        : "None"}`, "", "## Code comments", ""];
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
  const lines = [`# Graveyard — project debt grouped by ${mode}`, "", `Generated: ${safe(view.generatedAt)}`,
    `Generating checkout: ${safe(context.checkoutBranch ?? "detached HEAD")}`
      + (context.checkoutCommit ? ` (${safe(context.checkoutCommit)})` : " (no commit)"),
    `Scope: ${context.scope}`, `Scanned branches: ${view.branches.length}`, "", "## Summary", "",
    `Total debt: ${view.counts.total}`, `Code comments: ${view.counts.code}`,
    `Stale branches: ${view.counts.branches}`,
    `Fresh: ${view.counts.categories.fresh} · Ageing: ${view.counts.categories.ageing}`
      + ` · Buried: ${view.counts.categories.buried} · Fossil: ${view.counts.categories.fossil}`,
    `Oldest: ${view.oldest?.kind === "code" ? `code comment · ${view.oldest.finding.ageDays} days · ${place(view.oldest.finding)}`
      : view.oldest?.kind === "branches" ? `branch · ${view.oldest.finding.ageDays} days · ${safe(view.oldest.finding.branch.name)}`
        : "None"}`, ""];
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
  const lines = ["# Graveyard — summary by type", "", `Generated: ${safe(summary.generatedAt)}`,
    `Generating checkout: ${safe(context.checkoutBranch ?? "detached HEAD")}`
      + (context.checkoutCommit ? ` (${safe(context.checkoutCommit)})` : " (no commit)"),
    `Scope: ${context.scope}`, `Scanned branches: ${summary.branchCount}`, "",
    "| Debt type | Count |", "| --- | ---: |", `| Code comments | ${summary.counts.code} |`,
    `| Stale branches | ${summary.counts.branches} |`, "",
    `Total debt: ${summary.counts.total}`, "",
    `Fresh: ${summary.counts.categories.fresh} · Ageing: ${summary.counts.categories.ageing}`
      + ` · Buried: ${summary.counts.categories.buried} · Fossil: ${summary.counts.categories.fossil}`,
    `Oldest: ${summary.oldestKind === "code" ? `code comment · ${summary.oldest!.ageDays} days · ${place(summary.oldest as CodeFinding)}`
      : summary.oldestKind === "branches" ? `branch · ${summary.oldest!.ageDays} days · ${safe((summary.oldest as BranchTipFinding).branch.name)}`
        : "None"}`];
  if (summary.unscannedCount) lines.push("", `Unscanned files: ${summary.unscannedCount}; debt in these files is unknown.`);
  if (closingLine) lines.push("", `*${safe(closingLine)}*`);
  return lines.join("\n") + "\n";
}

export function renderAuthorSummaryMarkdown(summary: AuthorSummary,
  context: { checkoutBranch: string | null; checkoutCommit: string | null; scope: "local" | "remote" },
  closingLine?: string): string {
  const lines = ["# Graveyard — summary by author", "", `Generated: ${safe(summary.generatedAt)}`,
    `Generating checkout: ${safe(context.checkoutBranch ?? "detached HEAD")}`
      + (context.checkoutCommit ? ` (${safe(context.checkoutCommit)})` : " (no commit)"),
    `Scope: ${context.scope}`, `Scanned branches: ${summary.branchCount}`, "",
    "| Author | Count | Oldest |", "| --- | ---: | --- |"];
  for (const group of summary.groups) {
    const label = safe(group.label) + (group.codeCount === 0 && group.branchCount > 0 && group.identity !== "unknown" ? " (branches)" : "");
    const location = group.kind === "code" ? place(group.oldest as CodeFinding)
      : safe((group.oldest as BranchTipFinding).branch.name);
    lines.push(`| ${label} | ${group.count} | ${group.oldest.ageDays} days · ${location} |`);
  }
  lines.push("", `Total debt: ${summary.total}`, "",
    `Oldest: ${summary.oldestKind === "code" ? `code comment · ${summary.oldest!.ageDays} days · ${place(summary.oldest as CodeFinding)}`
      : summary.oldestKind === "branches" ? `branch · ${summary.oldest!.ageDays} days · ${safe((summary.oldest as BranchTipFinding).branch.name)}`
        : "None"}`);
  if (summary.unscannedCount) lines.push("", `Unscanned files: ${summary.unscannedCount}; debt in these files is unknown.`);
  if (closingLine) lines.push("", `*${safe(closingLine)}*`);
  return lines.join("\n") + "\n";
}
