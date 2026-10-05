import type { CommentScanResult } from "../scanners/comments/scan.js";
import type { DebtFinderConfig } from "../config/types.js";
import { ageInDays, categoryForAge, resolveAgeThresholds } from "./ages.js";
import type { CodeFinding, CodeFindingsSnapshot, UnscannedFile } from "./types.js";

/** Retain all scanned code findings and incomplete-coverage details before report filters run. */
export function buildCodeFindings(scan: CommentScanResult, config: DebtFinderConfig,
  asOf: Date): CodeFindingsSnapshot {
  if (!Number.isFinite(asOf.getTime())) throw new Error("Report generation date is invalid.");
  const aged: Array<Omit<CodeFinding, "category">> = [];
  const unscanned: UnscannedFile[] = [];
  for (const { branch, files } of scan.branches) {
    for (const entry of files) {
      if (entry.status === "skipped") {
        unscanned.push({ branch, file: entry.file, status: entry.status, reason: entry.reason });
      } else if (entry.status === "invalid" || entry.status === "unsupported") {
        unscanned.push({ branch, file: entry.file, status: entry.status, diagnostic: entry.diagnostic });
      } else if (entry.status === "ok") {
        for (const finding of entry.findings) {
          if (!finding.matches.length) throw new Error("A flagged comment has no marker matches.");
          const primary = finding.matches.reduce((oldest, candidate) =>
            candidate.attribution.authoredAt < oldest.attribution.authoredAt ? candidate : oldest);
          aged.push({ branch, file: entry.file, comment: finding.comment, matches: finding.matches,
            primary, ageDays: ageInDays(primary.attribution.authoredAt, asOf) });
        }
      }
    }
  }
  const oldestAged = aged.reduce<(typeof aged)[number] | undefined>((current, candidate) =>
    !current || candidate.ageDays > current.ageDays ? candidate : current, undefined);
  const thresholds = resolveAgeThresholds(config, oldestAged?.ageDays ?? 0);
  const findings: CodeFinding[] = aged.map((finding) => ({ ...finding,
    category: categoryForAge(finding.ageDays, thresholds) }));
  const oldest = oldestAged === undefined ? undefined : findings[aged.indexOf(oldestAged)];
  return { generatedAt: asOf.toISOString(), branches: scan.branches.map(({ branch }) => branch),
    backends: scan.backends, settings: structuredClone(config), thresholds, findings, unscanned, oldest };
}
