import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseConfiguration } from "../config/store.js";
import { CONFIG_FILENAME } from "../config/types.js";
import { runGit, type GitContext } from "../git/client.js";
import { resolveRepositoryRoot } from "../git/repository.js";

export interface SetupItem {
  id: string;
  status: "present" | "missing" | "conflict" | "review";
  message: string;
}

export interface SetupInspection {
  repositoryRoot: string;
  items: SetupItem[];
}

type FileInspection =
  | { state: "missing" }
  | { state: "error"; message: string }
  | { state: "present"; text: string };

async function inspectFile(path: string): Promise<FileInspection> {
  try {
    const stats = await lstat(path);
    if (!stats.isFile()) return { state: "error", message: "Expected a regular file; preserve this directory or symbolic link for manual review." };
    return { state: "present", text: await readFile(path, "utf8") };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" ? { state: "missing" }
      : { state: "error", message: "Cannot read file (" + (code ?? "filesystem error") + "). Preserve it for manual review." };
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function jsonObject(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text.replace(/^\uFEFF/, ""));
  if (!object(value)) throw new Error("Expected a JSON object.");
  return value;
}

interface IgnoreRule { source: string; line: string; pattern: string }

async function ignoreRules(paths: string[], context: GitContext): Promise<Map<string, IgnoreRule>> {
  let output: string;
  try {
    output = await runGit(["check-ignore", "--no-index", "--verbose", "--non-matching", "-z", "--stdin"],
      context, paths.join("\0") + "\0");
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    if (failure.code !== 1) throw new Error("Cannot inspect Git ignore rules: " + (failure.stderr?.trim() ?? "Git failed."));
    output = failure.stdout ?? "";
  }
  const fields = output.split("\0");
  const rules = new Map<string, IgnoreRule>();
  for (let i = 0; i + 3 < fields.length; i += 4) {
    const source = fields[i]!;
    const line = fields[i + 1]!;
    const pattern = fields[i + 2]!;
    const path = fields[i + 3]!;
    if (pattern && !pattern.startsWith("!")) rules.set(path, { source, line, pattern });
  }
  return rules;
}

/** Inspect the selected worktree without executing npm, package scripts, or writing files. */
export async function inspectSetup(repo: string | undefined, context: GitContext): Promise<SetupInspection> {
  const repositoryRoot = await resolveRepositoryRoot(repo, context);
  const gitContext = { ...context, cwd: repositoryRoot };
  const items: SetupItem[] = [];
  const add = (id: string, status: SetupItem["status"], message: string) => { items.push({ id, status, message }); };
  const [config, manifest, lock, ignore, installed, shrinkwrap] = await Promise.all([
    inspectFile(join(repositoryRoot, CONFIG_FILENAME)),
    inspectFile(join(repositoryRoot, "package.json")),
    inspectFile(join(repositoryRoot, "package-lock.json")),
    inspectFile(join(repositoryRoot, ".gitignore")),
    inspectFile(join(repositoryRoot, "node_modules", "debt-watcher", "package.json")),
    inspectFile(join(repositoryRoot, "npm-shrinkwrap.json")),
  ]);
  if (config.state === "missing") {
    add("config", "missing", "Create shared " + CONFIG_FILENAME + " from the template (fresh: 30 days) or chosen personal defaults.");
  } else if (config.state === "error") {
    add("config", "conflict", CONFIG_FILENAME + ": " + config.message);
  } else {
    try {
      parseConfiguration(config.text, join(repositoryRoot, CONFIG_FILENAME));
      add("config", "present", "Keep the existing valid shared configuration.");
    } catch (error) {
      add("config", "conflict", (error instanceof Error ? error.message : "Invalid configuration.") + " Preserve and correct this file.");
    }
  }

  let pkg: Record<string, unknown> | undefined;
  if (manifest.state === "missing") {
    add("package", "missing", 'Create a minimal package.json with "private": true; preserve the project as a non-publishable consumer.');
    pkg = {};
  } else if (manifest.state === "error") {
    add("package", "conflict", "package.json: " + manifest.message);
  } else {
    try {
      pkg = jsonObject(manifest.text);
      for (const field of ["scripts", "dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
        if (Object.hasOwn(pkg, field) && (!object(pkg[field])
          || Object.values(pkg[field]).some((value) => typeof value !== "string"))) {
          throw new Error(field + " must be an object of string values.");
        }
      }
      add("package", "present", "Keep package.json, including its existing private setting and unrelated fields.");
    } catch (error) {
      pkg = undefined;
      add("package", "conflict", "Invalid package.json: " + (error instanceof Error ? error.message : "invalid JSON") + " Preserve and correct it.");
    }
  }
  if (pkg) {
    const scripts = object(pkg.scripts) ? pkg.scripts : {};
    const script = scripts["debt-watcher"];
    add("script", script === undefined ? "missing" : script === "debt-watcher" ? "present" : "conflict",
      script === undefined ? 'Add npm script "debt-watcher": "debt-watcher".'
        : script === "debt-watcher" ? "Keep the matching debt-watcher npm script."
          : "An existing debt-watcher npm script differs. Ask before replacing it; preserve other scripts.");
    const declarations = ["devDependencies", "dependencies", "optionalDependencies", "peerDependencies"]
      .filter((field) => object(pkg[field]) && Object.hasOwn(pkg[field], "debt-watcher"));
    if (!declarations.length) add("dependency", "missing", "Use npm to add debt-watcher as a local development dependency and update the lockfile.");
    else if (declarations.length === 1 && declarations[0] === "devDependencies") {
      add("dependency", "present", "Debt Watcher is declared in devDependencies. npm must verify compatibility before reusing an installation.");
    } else {
      add("dependency", "review", "Debt Watcher is declared in " + declarations.join(", ") + ". Preserve its classification; review before any npm changes.");
    }
    if (pkg.workspaces !== undefined || (typeof pkg.packageManager === "string" && !pkg.packageManager.startsWith("npm@"))) {
      add("package-workflow", "review", "Workspace or non-npm package-manager settings exist. Resolve the installation target/workflow before applying setup.");
    }
    if (pkg.name === "debt-watcher") add("package-self", "conflict", "This is the debt-watcher package itself. Do not install it as its own dependency; use a separate consumer repository.");
  }

  if (installed.state === "missing") {
    add("installation", "missing", "No repository-local Debt Watcher package was found. npm will need to install it; a global copy is not team integration.");
  } else if (installed.state === "error") {
    add("installation", "conflict", "Local Debt Watcher package: " + installed.message);
  } else {
    try {
      const local = jsonObject(installed.text);
      if (local.name !== "debt-watcher" || typeof local.version !== "string" || !local.version.trim()) throw new Error("Missing package identity/version.");
      add("installation", "present", "Local Debt Watcher package metadata is present (version " + local.version + "). npm must verify its integrity and compatibility before reuse.");
    } catch {
      add("installation", "conflict", "Local Debt Watcher package metadata is invalid. Review the installation before repair.");
    }
  }
  if (lock.state === "missing") add("lockfile", "missing", "Let npm generate package-lock.json; do not construct it manually.");
  else if (lock.state === "error") add("lockfile", "conflict", "package-lock.json: " + lock.message);
  else {
    try {
      const saved = jsonObject(lock.text);
      if (![1, 2, 3].includes(saved.lockfileVersion as number)) throw new Error("Unrecognised lockfileVersion.");
      const records = object(saved.packages) ? saved.packages : undefined;
      const entry = records ? records["node_modules/debt-watcher"]
        : object(saved.dependencies) ? saved.dependencies["debt-watcher"] : undefined;
      add("lockfile", object(entry) ? "present" : "missing", object(entry)
        ? "package-lock.json records Debt Watcher. Let npm verify consistency with package.json before reuse."
        : "package-lock.json has no Debt Watcher entry. Let npm update it, preserving other dependencies.");
    } catch {
      add("lockfile", "conflict", "package-lock.json is invalid or uses an unsupported format. Preserve it for review; never hand-repair lock entries.");
    }
  }
  if (shrinkwrap.state !== "missing") add("shrinkwrap", "review", "npm-shrinkwrap.json exists or cannot be read. Resolve its lockfile precedence before planning package-lock.json changes.");

  if (ignore.state === "error") add("gitignore-file", "conflict", ".gitignore: " + ignore.message);
  const shared = [CONFIG_FILENAME, "package.json", "package-lock.json"];
  const [rules, trackedOutput] = await Promise.all([
    ignoreRules(["node_modules/", ...shared], gitContext),
    runGit(["ls-files", "-z", "--", "node_modules", ...shared], gitContext),
  ]);
  const tracked = new Set(trackedOutput.split("\0").filter(Boolean));
  const nodeRule = rules.get("node_modules/");
  // Machine-only ignore rules do not give teammates the same protection.
  const sharedNodeRule = nodeRule?.source === ".gitignore";
  add("ignore-node_modules", sharedNodeRule ? "present" : "missing",
    sharedNodeRule ? "node_modules/ is ignored by the repository .gitignore."
      : (nodeRule ? "node_modules/ is ignored only by " + nodeRule.source + ". " : "")
        + (ignore.state === "missing" ? "Create" : "Update") + " the repository .gitignore to share the node_modules/ rule.");
  if ([...tracked].some((path) => path.startsWith("node_modules/"))) {
    add("tracked-node_modules", "conflict", "Git already tracks files in node_modules/. Ignore rules do not untrack them; review separately. Setup must not remove or untrack files automatically.");
  }
  for (const path of shared) {
    const rule = rules.get(path);
    add("tracking-" + path, rule ? "review" : "present", rule
      ? path + " matches ignore rule " + rule.source + ":" + rule.line + " (" + rule.pattern + "). "
        + (tracked.has(path) ? "It is already tracked, but the rule should be reviewed." : "Review this rule so the shared file can be committed.")
      : path + (tracked.has(path) ? " is tracked by Git." : " is not ignored; commit it after setup."));
  }
  return { repositoryRoot, items };
}
