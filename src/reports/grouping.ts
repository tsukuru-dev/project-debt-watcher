import type { AgeCategory } from "./ages.js";
import type { CombinedReportView, ReportFinding } from "./types.js";

export interface DetailedGroup {
  identity: string;
  label: string;
  findings: ReportFinding[];
}

function dateOf(entry: ReportFinding): string {
  return entry.kind === "code" ? entry.finding.primary.attribution.authoredAt : entry.finding.committedAt;
}

function tieBreak(entry: ReportFinding): string {
  return entry.kind === "code"
    ? `code:${entry.finding.branch.ref}:${entry.finding.file.path}:${entry.finding.primary.line}`
    : `branches:${entry.finding.branch.ref}`;
}

function compareEntries(a: ReportFinding, b: ReportFinding, direction: 1 | -1): number {
  return dateOf(a).localeCompare(dateOf(b)) * direction || tieBreak(a).localeCompare(tieBreak(b));
}

export function authorIdentity(name: string, email: string, kind: ReportFinding["kind"]):
  { identity: string; label: string } {
  const cleanName = name.trim(), cleanEmail = email.trim();
  if (cleanEmail) return { identity: `email:${cleanEmail.toLowerCase()}`,
    label: cleanName ? `${cleanName} <${cleanEmail}>` : cleanEmail };
  if (cleanName) return { identity: `${kind}:name:${cleanName.toLowerCase()}`, label: cleanName };
  return { identity: "unknown", label: "Unknown" };
}

function entriesOf(view: CombinedReportView): ReportFinding[] {
  return [...view.findings.map((finding) => ({ kind: "code" as const, finding })),
    ...view.branchFindings.map((finding) => ({ kind: "branches" as const, finding }))];
}

/** Group the already filtered view, so every group total agrees with the report total. */
export function buildDetailedGroups(view: CombinedReportView, mode: "author" | "age"): DetailedGroup[] {
  const groups = new Map<string, DetailedGroup>();
  for (const entry of entriesOf(view)) {
    const key = mode === "age"
      ? { identity: entry.finding.category, label: entry.finding.category }
      : entry.kind === "code"
        ? authorIdentity(entry.finding.primary.attribution.authorName,
          entry.finding.primary.attribution.authorEmail, "code")
        : authorIdentity(entry.finding.authorName, entry.finding.authorEmail, "branches");
    const existing = groups.get(key.identity);
    if (existing) {
      existing.findings.push(entry);
      if (key.label.localeCompare(existing.label) < 0) existing.label = key.label;
    } else groups.set(key.identity, { ...key, findings: [entry] });
  }
  const direction = view.order === "oldnew" ? 1 : -1;
  for (const group of groups.values()) group.findings.sort((a, b) => compareEntries(a, b, direction));
  if (mode === "age") {
    const categories: AgeCategory[] = ["fossil", "buried", "ageing", "fresh"];
    const ordered = direction === 1 ? categories : [...categories].reverse();
    return ordered.flatMap((category) => groups.has(category) ? [groups.get(category)!] : []);
  }
  return [...groups.values()].sort((a, b) => {
    const oldestA = [...a.findings].sort((x, y) => compareEntries(x, y, 1))[0]!;
    const oldestB = [...b.findings].sort((x, y) => compareEntries(x, y, 1))[0]!;
    return dateOf(oldestA).localeCompare(dateOf(oldestB)) * direction
      || a.label.localeCompare(b.label) || a.identity.localeCompare(b.identity);
  });
}
