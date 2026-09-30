import { spawn } from "node:child_process";

export interface EditorOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

/** Split executable/arguments without shell expansion; preserve Windows backslashes. */
export function parseEditorCommand(command: string): string[] {
  const words: string[] = [];
  let word = "";
  let quote = "";
  let started = false;
  if (command.includes("\0")) throw new Error("The editor command contains a null character.");
  for (const character of command) {
    if (quote) {
      if (character === quote) quote = "";
      else word += character;
    } else if (character === '"' || character === "'") {
      quote = character;
      started = true;
    } else if (/\s/.test(character)) {
      if (started) words.push(word);
      word = "";
      started = false;
    } else {
      word += character;
      started = true;
    }
  }
  if (quote) throw new Error("The editor command has an unclosed quote.");
  if (started) words.push(word);
  if (!words[0]) throw new Error("The editor command must name an executable.");
  return words;
}

export function editorCommand(options: EditorOptions = {}): string[] {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const selected = env.VISUAL?.trim() || env.EDITOR?.trim();
  if (selected) return parseEditorCommand(selected);
  if (platform === "win32") return ["notepad.exe"];
  if (platform === "darwin") return ["/usr/bin/open", "-t"];
  return ["vi"];
}

/** Arguments, including the absolute config path, are never interpolated into a shell. */
export async function openEditor(path: string, options: EditorOptions = {}): Promise<void> {
  const [command, ...args] = editorCommand(options);
  if (!command) throw new Error("No editor executable was selected.");
  const platform = options.platform ?? process.platform;
  if (platform === "win32" && /\.(?:cmd|bat)$/i.test(command)) {
    throw new Error("Set VISUAL or EDITOR to an editor executable (.exe), not a .cmd or .bat wrapper.");
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args, path], {
      cwd: options.cwd, env: options.env ?? process.env,
      stdio: "inherit", shell: false, windowsHide: true,
    });
    child.once("error", (error) => {
      reject(new Error("Could not launch editor '" + command + "': " + error.message));
    });
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error("Editor exited with " + (signal ? "signal " + signal : "code " + code) + "."));
    });
  });
}
