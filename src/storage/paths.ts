import { homedir } from "node:os";
import { posix, win32 } from "node:path";

export interface UserPathOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDirectory?: string;
}

/** Resolve a location only; listing configuration must never create directories. */
export function userConfigDirectory(options: UserPathOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const home = options.homeDirectory ?? homedir();

  if (platform === "win32") {
    const base = env.APPDATA && win32.isAbsolute(env.APPDATA)
      ? env.APPDATA : win32.join(home, "AppData", "Roaming");
    return win32.join(base, "debt-finder");
  }
  if (platform === "darwin") {
    return posix.join(home, "Library", "Application Support", "debt-finder");
  }
  // XDG requires absolute base directories. Ignore relative environment values.
  const base = env.XDG_CONFIG_HOME && posix.isAbsolute(env.XDG_CONFIG_HOME)
    ? env.XDG_CONFIG_HOME : posix.join(home, ".config");
  return posix.join(base, "debt-finder");
}
