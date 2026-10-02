import type { DebtWatcherConfig } from "../config/types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export type AgeCategory = "fresh" | "ageing" | "buried" | "fossil";

export interface AgeThresholds {
  mode: "automatic" | "custom";
  fresh: number;
  ageing: number;
  buried: number;
}

/** Whole elapsed 24-hour periods; future-authored commits have age zero. */
export function ageInDays(authoredAt: string, asOf: Date): number {
  const authored = new Date(authoredAt);
  const elapsed = asOf.getTime() - authored.getTime();
  if (!Number.isFinite(elapsed)) throw new Error("Cannot calculate age from an invalid date.");
  return Math.max(0, Math.floor(elapsed / DAY_MS));
}

/** Automatic bands divide the non-fresh range through the oldest finding into thirds. */
export function resolveAgeThresholds(config: DebtWatcherConfig, oldestAge: number): AgeThresholds {
  if (!Number.isSafeInteger(oldestAge) || oldestAge < 0) throw new Error("Oldest finding age must be a non-negative whole number.");
  if (config.ageing !== undefined && config.buried !== undefined) {
    return { mode: "custom", fresh: config.fresh, ageing: config.ageing, buried: config.buried };
  }
  const span = Math.max(0, oldestAge - config.fresh);
  return { mode: "automatic", fresh: config.fresh,
    ageing: config.fresh + Math.floor(span / 3),
    buried: config.fresh + Math.floor(2 * span / 3) };
}

/** Thresholds are inclusive upper bounds; fossil is everything older than buried. */
export function categoryForAge(ageDays: number, thresholds: AgeThresholds): AgeCategory {
  if (!Number.isSafeInteger(ageDays) || ageDays < 0) throw new Error("Finding age must be a non-negative whole number.");
  if (ageDays <= thresholds.fresh) return "fresh";
  if (ageDays <= thresholds.ageing) return "ageing";
  if (ageDays <= thresholds.buried) return "buried";
  return "fossil";
}
