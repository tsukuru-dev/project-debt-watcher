import type { GraveyardArguments } from "./arguments.js";
import type { PreparedRepository } from "../setup/flow.js";
import { selectBranches } from "../git/branches.js";
import { scanCommittedComments } from "../scanners/comments/scan.js";
import { scanBranchTips } from "../scanners/branches.js";
import { buildCodeFindings } from "../reports/build.js";
import { buildCombinedReportView } from "../reports/filters.js";
import { renderAuthorSummaryTerminal, renderCombinedReportTerminal, renderTypeSummaryTerminal } from "../reports/render/terminal.js";
import { renderAuthorSummaryMarkdown, renderCombinedReportMarkdown, renderTypeSummaryMarkdown } from "../reports/render/markdown.js";
import { buildAuthorSummary, buildTypeSummary } from "../reports/summaries.js";
import { resolveReportSettings } from "../reports/settings.js";
import { saveMarkdownReport } from "../storage/exports.js";
import { latestReport, rememberReport } from "../storage/snapshots.js";
import { readConfiguration, saveConfiguration } from "../config/store.js";
import { confirm, isInteractive } from "../terminal/prompts.js";
import { isAbsolute, join, relative, sep } from "node:path";
import { resolveRepositoryRoot } from "../git/repository.js";
import { runGit } from "../git/client.js";
import { commitPermalink, resolveRemoteLinks, sourcePermalink } from "../git/remotes.js";
import { CONFIG_FILENAME, type ConfigurationLocation } from "../config/types.js";

export interface GraveyardContext {
  env?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  cwd: string;
  interactive?: boolean;
  confirm?: (question: string) => Promise<boolean>;
  writeOutput: (text: string) => void;
}

/** Reject unavailable views before interactive setup or an expensive source scan. */
export function assertCodeReportOptions(options: GraveyardArguments): void {
  if (options.filter?.type?.includes("issues")) {
    throw new Error("Only code and branches are available until issue scanning is implemented.");
  }
}

async function offerRememberDirectory(alternateDirectory: string | undefined,
  location: Extract<ConfigurationLocation, { scope: "repository" }>, context: GraveyardContext): Promise<void> {
  if (!alternateDirectory || !isInteractive(context.env, context.interactive)) return;
  if (!await (context.confirm ?? confirm)(
    `Save "${alternateDirectory}" as this team's default report directory in ${location.path}?`)) return;
  try {
    const config = await readConfiguration(location);
    const fromRoot = relative(location.repositoryRoot, alternateDirectory);
    const directory = !isAbsolute(fromRoot) && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`)
      ? `.${sep}${fromRoot || "."}` : alternateDirectory;
    await saveConfiguration(location, { ...config.document, reportDirectory: directory }, config.source);
    context.writeOutput(`Updated reportDirectory in ${location.path}\n`);
  } catch (error) {
    context.writeOutput(`Report saved, but reportDirectory was not updated: ${error instanceof Error ? error.message : "Unknown error."}\n`);
  }
}

/** Generate a code and branch report from immutable local or remote branch snapshots. */
export async function runGraveyard(options: GraveyardArguments, repository: PreparedRepository | undefined,
  context: GraveyardContext): Promise<void> {
  assertCodeReportOptions(options);
  const userPaths = { ...(context.env === undefined ? {} : { env: context.env }),
    ...(context.homeDirectory === undefined ? {} : { homeDirectory: context.homeDirectory }) };
  if (options.save === "latest") {
    const root = await resolveRepositoryRoot(options.repo, { cwd: context.cwd,
      ...(context.env === undefined ? {} : { env: context.env }) });
    const cached = await latestReport(root, userPaths);
    if (!cached) throw new Error("No previous report exists for this repository. Run debt-watcher graveyard or debt-watcher graveyard --save first.");
    const saved = await saveMarkdownReport(cached.markdown, {
      repositoryRoot: root, invocationDirectory: context.cwd,
      configuredDirectory: cached.settings.reportDirectory, generatedAt: cached.generatedAt,
      interactive: isInteractive(context.env, context.interactive),
      ...(options.output === undefined ? {} : { output: options.output }),
      ...(context.confirm === undefined ? {} : { confirm: context.confirm }),
    });
    context.writeOutput(`Exported report generated ${cached.generatedAt} from ${cached.checkoutBranch ?? "detached HEAD"}`
      + `${cached.checkoutCommit ? ` (${cached.checkoutCommit})` : " (no commit)"}, ${cached.scope} branches.\n`
      + `Saved report: ${saved.path}\n`);
    await offerRememberDirectory(saved.alternateDirectory,
      { scope: "repository", repositoryRoot: root, path: join(root, CONFIG_FILENAME) }, context);
    return;
  }
  if (!repository || repository.location.scope !== "repository") throw new Error("A prepared repository is required for reporting.");
  const settings = resolveReportSettings(repository.configuration, options);
  const git = { cwd: repository.location.repositoryRoot,
    ...(context.env === undefined ? {} : { env: context.env }) };
  const branches = await selectBranches(git, options.remote ? "remote" : "local");
  const asOf = new Date();
  const scan = await scanCommittedComments(git, branches, settings.markers);
  const branchScan = await scanBranchTips(git, branches, settings, asOf);
  const snapshot = buildCodeFindings(scan, settings, asOf);
  const view = buildCombinedReportView(snapshot, branchScan, {
    ...(options.filter === undefined ? {} : { filter: options.filter }),
    ...(options.order === undefined ? {} : { order: options.order }),
  });
  const summary = options.summary === "types" ? buildTypeSummary(view) : undefined;
  const authorSummary = options.summary === "blame" ? buildAuthorSummary(view) : undefined;
  const remotes = await resolveRemoteLinks(git);
  const links = {
    sourceLink: (finding: typeof view.findings[number]) => sourcePermalink(
      remotes.forBranch(finding.branch), finding.branch.commitId, finding.file.path, finding.primary.line),
    commitLink: (finding: typeof view.branchFindings[number]) => commitPermalink(
      remotes.forBranch(finding.branch), finding.branch.commitId),
  };
  const checkoutBranch = await runGit(["symbolic-ref", "--quiet", "--short", "HEAD"], git)
    .then((name) => name.trim(), () => null);
  const checkoutCommit = await runGit(["rev-parse", "--verify", "HEAD"], git)
    .then((commit) => commit.trim(), () => null);
  const reportContext = { checkoutBranch, checkoutCommit,
    scope: options.remote ? "remote" as const : "local" as const };
  const markdown = summary ? renderTypeSummaryMarkdown(summary, reportContext)
    : authorSummary ? renderAuthorSummaryMarkdown(authorSummary, reportContext)
      : renderCombinedReportMarkdown(view, reportContext, links);
  await rememberReport({ version: 1, repositoryRoot: repository.location.repositoryRoot,
    generatedAt: view.generatedAt, checkoutBranch, checkoutCommit,
    scope: options.remote ? "remote" : "local",
    mode: summary ? "types" : authorSummary ? "blame" : "detailed",
    scannedBranches: branches.map(({ ref, commitId }) => ({ ref, commitId })),
    settings: view.settings, filters: view.filters, order: view.order, markdown }, userPaths);
  context.writeOutput(summary ? renderTypeSummaryTerminal(summary)
    : authorSummary ? renderAuthorSummaryTerminal(authorSummary) : renderCombinedReportTerminal(view, links));
  if (options.save === true) {
    const interactive = isInteractive(context.env, context.interactive);
    const saved = await saveMarkdownReport(markdown, {
      repositoryRoot: repository.location.repositoryRoot, invocationDirectory: context.cwd,
      configuredDirectory: settings.reportDirectory, generatedAt: view.generatedAt, interactive,
      ...(options.output === undefined ? {} : { output: options.output }),
      ...(context.confirm === undefined ? {} : { confirm: context.confirm }),
    });
    context.writeOutput(`Saved report: ${saved.path}\n`);
    await offerRememberDirectory(saved.alternateDirectory, repository.location, context);
  }
}
