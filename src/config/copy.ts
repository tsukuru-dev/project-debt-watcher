import { posix, win32 } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { ConfigArguments } from "../commands/arguments.js";
import type { ConfigCommandContext } from "../commands/config.js";
import { confirm, isInteractive } from "../terminal/prompts.js";
import { resolveConfigurationLocation } from "./paths.js";
import { MissingConfigurationError, readConfiguration, readConfigurationSource, saveConfiguration, type ConfigurationSnapshot } from "./store.js";
import { readCheckout } from "../git/checkout.js";
import { CONFIG_KEYS, type ConfigurationDocument } from "./types.js";
import { validateConfiguration } from "./validate.js";

/** Only supported settings cross scopes; document metadata belongs to its destination. */
export function copySettings(source: ConfigurationDocument, destination?: ConfigurationDocument): ConfigurationDocument {
  const document: Record<string, unknown> = {};
  for (const key of CONFIG_KEYS) {
    if (Object.hasOwn(source, key)) document[key] = source[key];
  }
  for (const key of ["$schema", "metadata"] as const) {
    if (destination && Object.hasOwn(destination, key)) document[key] = destination[key];
  }
  return validateConfiguration(document);
}

export async function copyConfiguration(options: ConfigArguments, context: ConfigCommandContext): Promise<void> {
  const repoScope = options.repo === undefined ? {} : { repo: options.repo };
  const sourceLocation = await resolveConfigurationLocation(options.global ? repoScope : { global: true }, context);
  const sourceCheckout = sourceLocation.scope === "repository"
    ? await readCheckout({ ...context, cwd: sourceLocation.repositoryRoot }) : undefined;
  // A missing source must never be manufactured by first-use personal initialisation.
  const source = await readConfiguration(sourceLocation);
  const destinationLocation = await resolveConfigurationLocation(options.global ? { global: true } : repoScope, context);
  const destinationCheckout = destinationLocation.scope === "repository"
    ? await readCheckout({ ...context, cwd: destinationLocation.repositoryRoot }) : undefined;
  let destination: ConfigurationSnapshot | undefined;
  try {
    destination = await readConfiguration(destinationLocation);
  } catch (error) {
    if (!(error instanceof MissingConfigurationError)) throw error;
  }
  const document = copySettings(source.document, destination?.document);
  context.writeOutput("Source: " + sourceLocation.path + "\nDestination: " + destinationLocation.path + "\n");
  if (destination && isDeepStrictEqual(document, destination.document)) {
    context.writeOutput("No changes: destination settings already match the source.\n");
    return;
  }
  context.writeOutput("Copy all supported settings, replacing destination settings and keeping destination metadata.\n");
  if (posix.isAbsolute(document.reportDirectory) || win32.isAbsolute(document.reportDirectory)) {
    context.writeOutput("The absolute reportDirectory may be specific to this machine: " + document.reportDirectory + "\n");
  }
  if (destination) {
    if (!isInteractive(context.env, context.interactive)) {
      throw new Error("Replacing an existing configuration requires confirmation. Run this copy command in an interactive terminal.");
    }
    if (!await (context.confirm ?? confirm)("Replace settings in \"" + destinationLocation.path + "\"?")) {
      throw new Error("Copy cancelled. No configuration files were changed.");
    }
  }
  for (const [location, checkout] of [[sourceLocation, sourceCheckout], [destinationLocation, destinationCheckout]] as const) {
    if (location.scope === "repository" && await readCheckout({ ...context, cwd: location.repositoryRoot }) !== checkout) {
      throw new Error("The active checkout changed during configuration copying. Run the command again. No configuration files were changed.");
    }
  }
  if (await readConfigurationSource(sourceLocation) !== source.source) {
    throw new Error("The source configuration changed during copying. Run the command again. No destination changes were made.");
  }
  await saveConfiguration(destinationLocation, document, destination?.source ?? null, { allowCreateRepository: true });
  context.writeOutput("Copied configuration settings to " + destinationLocation.path + "\n");
}
