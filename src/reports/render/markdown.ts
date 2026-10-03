import type { CodeFinding, CodeReportView, UnscannedFile } from "../types.js";

const AGE_ICONS = { fresh: "🌱", ageing: "💀", buried: "🪦", fossil: "🦖" } as const;

function safe(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ").replace(/\s+/gu, " ").trim()
    .replaceAll("\\", "\\\\").replaceAll("|", "\\|").replaceAll("`", "\\`")
    .replaceAll("[", "\\[").replaceAll("]", "\\]").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function place(finding: CodeFinding): string {
  return `${safe(finding.branch.name)}:${safe(finding.file.path)}:${finding.primary.line}`;
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
