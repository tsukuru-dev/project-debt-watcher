import { join, posix, win32 } from "node:path";
import { resolveRepositoryRoot } from "../git/repository.js";
import { userConfigDirectory, type UserPathOptions } from "../storage/paths.js";
import { CONFIG_FILENAME, type ConfigurationLocation } from "./types.js";

export interface ConfigurationScope {
  global?: boolean;
  repo?: string;
}

export interface ConfigurationPathContext extends UserPathOptions {
  cwd: string;
}

export async function resolveConfigurationLocation(
  options: ConfigurationScope,
  context: ConfigurationPathContext,
): Promise<ConfigurationLocation> {
  if (options.global) {
    if (options.repo !== undefined) {
      throw new Error("Selecting personal defaults cannot be combined with --repo; only copying from a repository permits it.");
    }
    const paths = (context.platform ?? process.platform) === "win32" ? win32 : posix;
    return { scope: "global", path: paths.join(userConfigDirectory(context), CONFIG_FILENAME) };
  }
  const repositoryRoot = await resolveRepositoryRoot(options.repo, context);
  return { scope: "repository", path: join(repositoryRoot, CONFIG_FILENAME), repositoryRoot };
}
