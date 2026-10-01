import { posix, win32 } from "node:path";
import { copySettings } from "../config/copy.js";
import { resolveConfigurationLocation, type ConfigurationPathContext } from "../config/paths.js";
import { loadDefaultConfiguration, parseConfiguration, saveConfiguration } from "../config/store.js";
import type { ConfigurationDocument } from "../config/types.js";
import type { ConfigurationInteraction } from "../commands/config.js";
import { chooseDefaults, confirm } from "../terminal/prompts.js";
import { readSetupFile } from "./files.js";
import { SetupCancelledError } from "./team.js";

type DefaultsContext = ConfigurationPathContext & ConfigurationInteraction & { writeOutput: (text: string) => void };

/** Existing personal files are never replaced or applied to an existing repository. */
export async function initialisePersonalDefaults(context: DefaultsContext): Promise<void> {
  const location = await resolveConfigurationLocation({ global: true }, context);
  if (await readSetupFile(location.path) !== null) return;
  try {
    await saveConfiguration(location, await loadDefaultConfiguration(), null);
  } catch (error) {
    // Another invocation may have created the file while we read the template.
    if (await readSetupFile(location.path) === null) throw error;
    return;
  }
  context.writeOutput("Created personal defaults: " + location.path + "\n");
}

export async function selectStartingConfiguration(context: DefaultsContext): Promise<ConfigurationDocument> {
  const location = await resolveConfigurationLocation({ global: true }, context);
  const source = await readSetupFile(location.path);
  if (source === null) return loadDefaultConfiguration();
  const choice = await (context.chooseDefaults ?? chooseDefaults)(location.path);
  if (choice === undefined) throw new SetupCancelledError("Setup cancelled. No project files changed.");
  if (choice === "template") return loadDefaultConfiguration();
  const settings = copySettings(parseConfiguration(source, location.path));
  context.writeOutput("Copying personal settings into the shared repository config; future personal edits will not change it.\n");
  if (posix.isAbsolute(settings.reportDirectory) || win32.isAbsolute(settings.reportDirectory)) {
    context.writeOutput("The absolute reportDirectory may be specific to this machine: " + settings.reportDirectory + "\n");
    if (!await (context.confirm ?? confirm)("Copy this machine-specific report directory into the team's configuration?")) {
      throw new SetupCancelledError("Setup cancelled. No project files changed.");
    }
  }
  if (await readSetupFile(location.path) !== source) {
    throw new Error("Personal defaults changed during setup. Run init again to choose the current settings. No project files changed.");
  }
  return settings;
}
