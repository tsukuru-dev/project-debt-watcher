import type { ConfigurationInteraction } from "../commands/config.js";
import type { ConfigurationScope } from "../config/paths.js";
import { resolveConfigurationLocation } from "../config/paths.js";
import { loadConfiguration, MissingConfigurationError } from "../config/store.js";
import { CONFIG_FILENAME, type ConfigurationDocument, type ConfigurationLocation } from "../config/types.js";
import { join } from "node:path";
import { rememberSetupDecision, setupDeclined } from "../storage/setup-state.js";
import type { UserPathOptions } from "../storage/paths.js";
import { openEditor } from "../terminal/editor.js";
import { isInteractive } from "../terminal/prompts.js";
import { selectStartingConfiguration } from "./defaults.js";
import { inspectSetup, isRecord, parsePackageObject, type SetupInspection } from "./inspect.js";
import { readSetupFile } from "./files.js";
import { applyTeamSetup, printInspection, reusableInstallation, SetupCancelledError, SetupVerificationError, type TeamSetupContext } from "./team.js";
import { runNpm } from "./npm.js";

export type SetupFlowContext = TeamSetupContext & ConfigurationInteraction & UserPathOptions;

export async function completeTeamSetup(inspection: SetupInspection, context: SetupFlowContext): Promise<void> {
  await applyTeamSetup(inspection, {
    ...context,
    selectStartingConfiguration: context.selectStartingConfiguration
      ?? (() => context.startingConfiguration ? Promise.resolve(context.startingConfiguration) : selectStartingConfiguration(context)),
  });
  if (!isInteractive(context.env, context.interactive)) return;
  try { await rememberSetupDecision(inspection.repositoryRoot, false, context); }
  catch (error) { context.writeOutput("Could not clear the saved setup decision: " + message(error) + "\n"); }
  const path = join(inspection.repositoryRoot, CONFIG_FILENAME);
  context.writeOutput("Configuration: " + path + "\n");
  try {
    if (context.openEditor) await context.openEditor(path);
    else await openEditor(path, { cwd: inspection.repositoryRoot, env: context.env ?? process.env, platform: process.platform });
  } catch (error) {
    context.writeOutput("Setup is complete, but the editor could not open: " + message(error)
      + "\nOpen the configuration manually: \"" + path + "\".\n");
  }
}

function message(error: unknown): string { return error instanceof Error ? error.message : "Unknown error."; }

export interface PreparedRepository {
  location: ConfigurationLocation;
  configuration: ConfigurationDocument;
}

/** Establish the active worktree config, then return to the originally requested report. */
export async function prepareReportRepository(options: ConfigurationScope, context: SetupFlowContext): Promise<PreparedRepository> {
  const location = await resolveConfigurationLocation(options, context);
  if (location.scope !== "repository") throw new Error("Reports require repository configuration.");
  let configuration: ConfigurationDocument | undefined;
  try { configuration = await loadConfiguration(location); }
  catch (error) { if (!(error instanceof MissingConfigurationError)) throw error; }
  const ready = async (): Promise<PreparedRepository> => ({ location, configuration: await loadConfiguration(location) });
  const verificationUnavailable = (error: unknown): Promise<PreparedRepository> => {
    context.writeOutput("Could not verify team installation: " + message(error)
      + "\nContinuing with the valid repository configuration. Run debt-watcher init to check the installation.\n");
    return ready();
  };
  if (!isInteractive(context.env, context.interactive)) {
    if (!configuration) throw new MissingConfigurationError(location);
    return { location, configuration };
  }
  const inspection = await inspectSetup(location.repositoryRoot, context);
  let preserveProduction = false;
  if (inspection.items.some((item) => item.id === "dependency" && item.status === "review")) {
    const source = await readSetupFile(join(location.repositoryRoot, "package.json"));
    if (source !== null) {
      const pkg = parsePackageObject(source);
      const declarations = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]
        .filter((key) => isRecord(pkg[key]) && Object.hasOwn(pkg[key], "debt-watcher"));
      preserveProduction = declarations.length === 1 && declarations[0] === "dependencies";
    }
  }
  const outstanding = inspection.items.filter((item) => item.status !== "present"
    && !(item.id === "dependency" && preserveProduction));
  if (configuration && outstanding.some((item) => (item.status === "conflict" || item.status === "review") && item.id !== "script")) {
    printInspection(inspection, context.writeOutput);
    context.writeOutput("Team integration needs manual attention before init can repair it. Continuing with the valid repository configuration.\n");
    return ready();
  }
  let declined = false;
  try { declined = await setupDeclined(location.repositoryRoot, context); }
  catch (error) { context.writeOutput(message(error) + "\n"); }
  if (declined) {
    if (!configuration) throw new Error("Repository configuration is missing. Run debt-watcher init to complete team setup.");
    return ready();
  }
  if (!outstanding.length) {
    // Presence alone does not establish executable integrity or lockfile compatibility.
    const root = location.repositoryRoot;
    try {
      const source = await readSetupFile(join(root, "package.json"));
      if (source !== null && await reusableInstallation(root, parsePackageObject(source), context.npm ?? runNpm,
        { cwd: root, env: context.env ?? process.env })) return ready();
    } catch (error) {
      return verificationUnavailable(error);
    }
    context.writeOutput("The local executable or dependency/lockfile verification failed; team installation needs repair.\n");
  }
  context.writeOutput(configuration ? "Team integration needs repair; existing configuration will be preserved.\n"
    : "This repository needs team setup before reporting.\n");
  printInspection(inspection, context.writeOutput);
  try {
    await completeTeamSetup(inspection, context);
  } catch (error) {
    if (configuration && error instanceof SetupVerificationError) return verificationUnavailable(error);
    if (!(error instanceof SetupCancelledError)) throw error;
    try { await rememberSetupDecision(location.repositoryRoot, true, context); }
    catch (stateError) { context.writeOutput("Could not remember this decision: " + message(stateError) + "\n"); }
    context.writeOutput("Setup declined. Run debt-watcher init whenever you want to set up or repair this repository.\n");
    if (!configuration) throw new Error("Report cancelled: required repository configuration is missing. Run debt-watcher init.");
  }
  return ready();
}
