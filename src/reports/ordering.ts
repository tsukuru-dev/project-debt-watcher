import type { CodeFinding } from "./types.js";

/** Compare actual author timestamps, then committed locations, so sub-day ages remain ordered. */
export function compareCodeFindings(a: CodeFinding, b: CodeFinding): number {
  const date = a.primary.attribution.authoredAt.localeCompare(b.primary.attribution.authoredAt);
  if (date) return date;
  return a.branch.ref.localeCompare(b.branch.ref)
    || a.file.path.localeCompare(b.file.path)
    || a.comment.start.offset - b.comment.start.offset
    || a.primary.line - b.primary.line;
}

/** Return a new array; changing display direction never changes the oldest item's identity. */
export function orderCodeFindings(findings: readonly CodeFinding[], direction: "oldnew" | "newold"): CodeFinding[] {
  if (direction !== "oldnew" && direction !== "newold") throw new Error("Order must be oldnew or newold.");
  return [...findings].sort((a, b) => {
    const chronological = a.primary.attribution.authoredAt.localeCompare(b.primary.attribution.authoredAt);
    if (chronological) return direction === "oldnew" ? chronological : -chronological;
    return compareCodeFindings(a, b);
  });
}
