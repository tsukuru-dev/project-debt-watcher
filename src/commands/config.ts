import type { ConfigArguments } from "./arguments.js";
import { applyConfigurationEdit, parseConfigurationEdit } from "../config/actions.js";
import { resolveConfigurationLocation, type ConfigurationPathContext } from "../config/paths.js";
import { loadConfiguration, loadDefaultConfiguration, MissingConfigurationError, readConfiguration, saveConfiguration } from "../config/store.js";
import { CONFIG_KEYS, isConfigKey } from "../config/types.js";

export interface ConfigCommandContext extends ConfigurationPathContext {
  writeOutput: (text: string) => void;
}

export async function runConfig(
  options: ConfigArguments,
  context: ConfigCommandContext = {
    cwd: process.cwd(),
    writeOutput: (text) => { process.stdout.write(text); },
  },
): Promise<void> {
  if (options.list === undefined) {
    const input = options.set !== undefined ? { action: "set" as const, assignments: options.set }
      : options.add !== undefined ? { action: "add" as const, assignment: options.add }
      : options.remove !== undefined ? { action: "remove" as const, assignment: options.remove }
      : undefined;
    if (!input) {
      throw new Error("Configuration copying and opening are not implemented yet. Use config --list, --set, --add, or --remove.");
    }
    const edit = parseConfigurationEdit(input);
    const location = await resolveConfigurationLocation(options, context);
    let document;
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
