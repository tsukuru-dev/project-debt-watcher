import type { ConfigArguments } from "./arguments.js";
import { resolveConfigurationLocation, type ConfigurationPathContext } from "../config/paths.js";
import { loadConfiguration } from "../config/store.js";
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
    throw new Error("Configuration editing, copying, and opening are not implemented yet. Use config --list to inspect saved settings.");
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
