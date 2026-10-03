import type { GraveyardArguments } from "./arguments.js";
import type { PreparedRepository } from "../setup/flow.js";
import { selectBranches } from "../git/branches.js";
import { scanCommittedComments } from "../scanners/comments/scan.js";
import { buildCodeFindings } from "../reports/build.js";
import { buildCodeReportView } from "../reports/filters.js";
import { renderCodeReportTerminal } from "../reports/render/terminal.js";
import { resolveReportSettings } from "../reports/settings.js";

export interface GraveyardContext {
  env?: NodeJS.ProcessEnv;
  writeOutput: (text: string) => void;
}

/** Reject unavailable views before interactive setup or an expensive source scan. */
export function assertCodeReportOptions(options: GraveyardArguments): void {
  if (options.save !== undefined) throw new Error("Saving reports is not implemented yet. Run graveyard without --save.");
  if (options.summary !== undefined) throw new Error("Report summaries are not implemented yet. Run graveyard without --summary.");
  if (options.filter?.type?.some((type) => type !== "code")) {
    throw new Error("Only type=code is available until branch and issue scanning are implemented.");
  }
}

/** Generate the current code-only report from immutable local or remote branch snapshots. */
export async function runGraveyard(options: GraveyardArguments, repository: PreparedRepository | undefined,
  context: GraveyardContext): Promise<void> {
  assertCodeReportOptions(options);
  if (!repository || repository.location.scope !== "repository") throw new Error("A prepared repository is required for reporting.");
  const settings = resolveReportSettings(repository.configuration, options);
  const git = { cwd: repository.location.repositoryRoot,
    ...(context.env === undefined ? {} : { env: context.env }) };
  const branches = await selectBranches(git, options.remote ? "remote" : "local");
  const scan = await scanCommittedComments(git, branches, settings.markers);
  const snapshot = buildCodeFindings(scan, settings, new Date());
  const view = buildCodeReportView(snapshot, {
    ...(options.filter === undefined ? {} : { filter: options.filter }),
    ...(options.order === undefined ? {} : { order: options.order }),
  });
  context.writeOutput(renderCodeReportTerminal(view));
}
