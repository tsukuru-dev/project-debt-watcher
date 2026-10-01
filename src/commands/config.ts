import type { ConfigArguments } from "./arguments.js";
import { applyConfigurationEdit, parseConfigurationEdit } from "../config/actions.js";
import { copyConfiguration } from "../config/copy.js";
import { resolveConfigurationLocation, type ConfigurationPathContext } from "../config/paths.js";
import {
  loadConfiguration, loadDefaultConfiguration, MissingConfigurationError,
  parseConfiguration, readConfiguration, readConfigurationSource, saveConfiguration,
} from "../config/store.js";
import { CONFIG_KEYS, isConfigKey, type ConfigurationDocument } from "../config/types.js";
import { openEditor } from "../terminal/editor.js";
import { isInteractive } from "../terminal/prompts.js";

export interface ConfigurationInteraction {
  interactive?: boolean;
  confirm?: (question: string) => Promise<boolean>;
  openEditor?: (path: string) => Promise<void>;
  chooseDefaults?: (personalPath: string) => Promise<"personal" | "template" | undefined>;
}

export interface ConfigCommandContext extends ConfigurationPathContext, ConfigurationInteraction {
  writeOutput: (text: string) => void;
}

async function openConfiguration(options: ConfigArguments, context: ConfigCommandContext): Promise<void> {
  const location = await resolveConfigurationLocation(options, context);
  if (!isInteractive(context.env, context.interactive)) {
    throw new Error("Cannot open an editor in non-interactive use. Configuration: \"" + location.path
      + "\". Open it manually, or use config --list or --set.");
  }
  try {
    const source = await readConfigurationSource(location);
    try {
      parseConfiguration(source, location.path);
    } catch (error) {
      // Opening is also how users repair malformed JSON; never replace it with defaults.
      context.writeOutput((error instanceof Error ? error.message : "Invalid configuration.")
        + "\nOpening the existing file for manual correction.\n");
    }
  } catch (error) {
    if (location.scope !== "global" || !(error instanceof MissingConfigurationError)) throw error;
    await saveConfiguration(location, await loadDefaultConfiguration(), null);
    context.writeOutput("Created personal configuration from the supplied template.\n");
  }
  context.writeOutput("Configuration: " + location.path + "\n");
  try {
    if (context.openEditor) await context.openEditor(location.path);
    else await openEditor(location.path, {
      cwd: context.cwd, env: context.env ?? process.env,
      platform: context.platform ?? process.platform,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Editor launch failed.";
    throw new Error(message + " Open the configuration manually: \"" + location.path + "\".");
  }
}

export async function runConfig(
  options: ConfigArguments,
  context: ConfigCommandContext = {
    cwd: process.cwd(),
    writeOutput: (text) => { process.stdout.write(text); },
  },
): Promise<void> {
  if (options.copyFrom !== undefined) {
    await copyConfiguration(options, context);
    return;
  }
  if (options.list === undefined) {
    const input = options.set !== undefined ? { action: "set" as const, assignments: options.set }
      : options.add !== undefined ? { action: "add" as const, assignment: options.add }
      : options.remove !== undefined ? { action: "remove" as const, assignment: options.remove }
      : undefined;
    if (!input) {
      await openConfiguration(options, context);
      return;
    }
    const edit = parseConfigurationEdit(input);
    const location = await resolveConfigurationLocation(options, context);
    let document: ConfigurationDocument;
    let original: string | null;
    try {
      const saved = await readConfiguration(location);
      document = saved.document;
      original = saved.source;
    } catch (error) {
      if (location.scope !== "global" || !(error instanceof MissingConfigurationError)) throw error;
      document = await loadDefaultConfiguration();
      original = null;
    }
    const result = applyConfigurationEdit(document, edit);
    if (result.changed || original === null) {
      await saveConfiguration(location, result.document, original);
    }
    const message = original === null ? "Created personal configuration with the requested settings." : result.message;
    context.writeOutput(`Configuration: ${location.path}\n${message}\n`);
    return;
  }
  if (options.list !== true && !isConfigKey(options.list)) {
    throw new Error(`Unknown configuration key '${options.list}'. Available settings: ${CONFIG_KEYS.join(", ")}.`);
  }

  const location = await resolveConfigurationLocation(options, context);
  const config = await loadConfiguration(location);
  let content: string;
  if (options.list === true) {
    content = JSON.stringify(config, null, 2);
  } else if (options.list === "markers") {
    content = config.markers.length ? config.markers.join("\n") : "(no markers configured)";
  } else {
    const value = config[options.list];
    content = value === undefined ? "(not set; automatic age bands)" : JSON.stringify(value, null, 2);
  }
  context.writeOutput(`Configuration: ${location.path}\n${content}\n`);
}
