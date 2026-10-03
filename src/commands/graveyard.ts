import type { GraveyardArguments } from "./arguments.js";
import type { PreparedRepository } from "../setup/flow.js";
import { selectBranches } from "../git/branches.js";
import { scanCommittedComments } from "../scanners/comments/scan.js";
import { buildCodeFindings } from "../reports/build.js";
import { buildCodeReportView } from "../reports/filters.js";
import { renderCodeReportTerminal } from "../reports/render/terminal.js";
import { renderCodeReportMarkdown } from "../reports/render/markdown.js";
import { resolveReportSettings } from "../reports/settings.js";
import { saveMarkdownReport } from "../storage/exports.js";
import { readConfiguration, saveConfiguration } from "../config/store.js";
import { confirm, isInteractive } from "../terminal/prompts.js";
import { isAbsolute, relative, sep } from "node:path";

export interface GraveyardContext {
  env?: NodeJS.ProcessEnv;
  cwd: string;
  interactive?: boolean;
  confirm?: (question: string) => Promise<boolean>;
  writeOutput: (text: string) => void;
}

/** Reject unavailable views before interactive setup or an expensive source scan. */
export function assertCodeReportOptions(options: GraveyardArguments): void {
  if (options.save === "latest") throw new Error("Exporting the latest report is not implemented yet. Use --save to generate a new report.");
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
  if (options.save === true) {
    const interactive = isInteractive(context.env, context.interactive);
    const saved = await saveMarkdownReport(renderCodeReportMarkdown(view), {
      repositoryRoot: repository.location.repositoryRoot, invocationDirectory: context.cwd,
      configuredDirectory: settings.reportDirectory, generatedAt: view.generatedAt, interactive,
      ...(options.output === undefined ? {} : { output: options.output }),
      ...(context.confirm === undefined ? {} : { confirm: context.confirm }),
    });
    context.writeOutput(`Saved report: ${saved.path}\n`);
    if (saved.alternateDirectory && interactive && await (context.confirm ?? confirm)(
      `Save "${saved.alternateDirectory}" as this team's default report directory in ${repository.location.path}?`)) {
      try {
        const config = await readConfiguration(repository.location);
        const root = repository.location.repositoryRoot;
        const fromRoot = relative(root, saved.alternateDirectory);
        const directory = !isAbsolute(fromRoot) && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`)
          ? `.${sep}${fromRoot || "."}` : saved.alternateDirectory;
        await saveConfiguration(repository.location, { ...config.document, reportDirectory: directory }, config.source);
        context.writeOutput(`Updated reportDirectory in ${repository.location.path}\n`);
      } catch (error) {
        context.writeOutput(`Report saved, but reportDirectory was not updated: ${error instanceof Error ? error.message : "Unknown error."}\n`);
      }
    }
  }
}
