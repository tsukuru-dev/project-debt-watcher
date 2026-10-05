import { stat, realpath } from "node:fs/promises";
import { join, resolve, relative, isAbsolute } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { CONFIG_FILENAME, type ConfigurationDocument } from "../config/types.js";
import { loadDefaultConfiguration, saveConfiguration } from "../config/store.js";
import { validateConfiguration } from "../config/validate.js";
import type { GitContext } from "../git/client.js";
import { readCheckout } from "../git/checkout.js";
import { confirm, isInteractive } from "../terminal/prompts.js";
import { inspectSetup, isRecord, parsePackageObject, type SetupInspection } from "./inspect.js";
import { assertUnchanged, assertWritable, formatPackage, readSetupFile, writeSetupFile } from "./files.js";
import { runNpm, type NpmRunner } from "./npm.js";

export interface TeamSetupContext extends GitContext {
  version: string;
  writeOutput: (text: string) => void;
  interactive?: boolean;
  confirm?: (question: string) => Promise<boolean>;
  /** Integration seams for local archive tests and the shared first-use setup flow. */
  npm?: NpmRunner;
  packageSpec?: string;
  startingConfiguration?: ConfigurationDocument;
  selectStartingConfiguration?: () => Promise<ConfigurationDocument>;
}

export class SetupCancelledError extends Error {}

/** Installation verification failed before confirmation or any setup writes. */
export class SetupVerificationError extends Error {}

export function printInspection(inspection: SetupInspection, write: (text: string) => void): void {
  write("Setup inspection: " + inspection.repositoryRoot + "\n"
    + inspection.items.map((item) => "[" + item.status.toUpperCase() + "] " + item.message).join("\n") + "\n");
}

/** npm validates installed versions; we also require a matching lock entry and usable CLI files. */
export async function reusableInstallation(root: string, pkg: Record<string, unknown>, npm: NpmRunner, context: GitContext): Promise<boolean> {
  const localText = await readSetupFile(join(root, "node_modules", "debt-finder", "package.json"));
  const lockText = await readSetupFile(join(root, "package-lock.json"));
  if (!localText || !lockText) return false;
  const local = parsePackageObject(localText);
  const lock = parsePackageObject(lockText);
  const records = isRecord(lock.packages) ? lock.packages : {};
  const locked = records["node_modules/debt-finder"];
  const lockedRoot = records[""];
  if (local.name !== "debt-finder" || typeof local.version !== "string" || !isRecord(locked)
    || locked.version !== local.version || !isRecord(lockedRoot)) return false;
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
    if (!isDeepStrictEqual(pkg[field] ?? {}, lockedRoot[field] ?? {})) return false;
  }
  const bin = typeof local.bin === "string" ? local.bin : isRecord(local.bin) ? local.bin["debt-finder"] : undefined;
  if (typeof bin !== "string") return false;
  try {
    const packageRoot = await realpath(join(root, "node_modules", "debt-finder"));
    const executable = await realpath(resolve(packageRoot, bin));
    const child = relative(packageRoot, executable);
    if (child.startsWith("..") || isAbsolute(child) || !(await stat(executable)).isFile()) return false;
    if (!(await stat(join(root, "node_modules", ".bin", process.platform === "win32" ? "debt-finder.cmd" : "debt-finder"))).isFile()) return false;
  } catch { return false; }
  for (const flags of [[], ["--package-lock-only", "--package-lock=true"]]) {
    const result = await npm(["ls", "--json", "--all", ...flags], context);
    if (result.code !== 0) return false;
    try {
      const tree = parsePackageObject(result.stdout);
      const dependency = isRecord(tree.dependencies) ? tree.dependencies["debt-finder"] : undefined;
      if (!isRecord(dependency) || dependency.version !== local.version
        || dependency.invalid || dependency.missing || dependency.extraneous
        || (Array.isArray(tree.problems) && tree.problems.length > 0)) return false;
    } catch { return false; }
  }
  return true;
}

function unrelatedPackageFields(pkg: Record<string, unknown>): Record<string, unknown> {
  const copy = structuredClone(pkg);
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    if (isRecord(copy[field])) {
      delete copy[field]["debt-finder"];
      if (!Object.keys(copy[field]).length) delete copy[field];
    }
  }
  return copy;
}

/** Apply only after the plan and every conflict decision have been confirmed. */
export async function applyTeamSetup(inspection: SetupInspection, context: TeamSetupContext): Promise<void> {
  const root = inspection.repositoryRoot;
  const localContext = { cwd: root, env: context.env ?? process.env };
  const npm = context.npm ?? runNpm;
  const names = [CONFIG_FILENAME, "package.json", "package-lock.json", ".gitignore", ".npmrc",
    "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb"];
  const snapshots = new Map<string, string | null>();
  for (const name of names) snapshots.set(name, await readSetupFile(join(root, name)));
  const originalCheckout = await readCheckout(localContext);
  // Reinspect after snapshotting so stale caller plans cannot authorize new changes.
  const fresh = await inspectSetup(root, localContext);
  if (!isDeepStrictEqual(fresh, inspection)) throw new Error("Setup state changed. Run init again to review the new plan.");
  const pkgText = snapshots.get("package.json")!;
  const pkg = pkgText === null ? { private: true } : parsePackageObject(pkgText);
  const declarations = ["devDependencies", "dependencies", "optionalDependencies", "peerDependencies"]
    .filter((field) => isRecord(pkg[field]) && Object.hasOwn(pkg[field], "debt-finder"));
  const preserveProduction = declarations.length === 1 && declarations[0] === "dependencies";
  const blockers = fresh.items.filter((item) => (item.status === "review" || item.status === "conflict")
    && item.id !== "script" && !(item.id === "dependency" && preserveProduction));
  if (blockers.length) throw new Error("Resolve these setup items before applying changes: " + blockers.map((item) => item.id).join(", ") + ". No files changed.");
  const originalSpec = declarations.length ? (pkg[declarations[0]!] as Record<string, string>)["debt-finder"] : undefined;
  let startingConfig = snapshots.get(CONFIG_FILENAME) === null
    ? validateConfiguration(context.startingConfiguration ?? await loadDefaultConfiguration()) : undefined;
  let installNeeded: boolean;
  try {
    installNeeded = !declarations.length || !await reusableInstallation(root, pkg, npm, localContext);
  } catch (error) {
    throw new SetupVerificationError(error instanceof Error ? error.message : "Installation verification failed.", { cause: error });
  }
  const scriptConflict = fresh.items.some((item) => item.id === "script" && item.status === "conflict");
  const needsFiles = fresh.items.some((item) => item.status === "missing") || scriptConflict;
  if (!installNeeded && !needsFiles) {
    context.writeOutput("Team setup is already complete. Existing settings and installation were reused; no files changed.\n");
    return;
  }
  context.writeOutput("Plan: preserve existing config and unrelated package fields; create missing config, "
    + "add the debt-finder script, and share the node_modules/ ignore rule as needed.\n");
  if (startingConfig) context.writeOutput(context.selectStartingConfiguration
    ? "For missing config, choose personal defaults when available or the supplied template (fresh=30 days).\n"
    : "New configuration starts with fresh=" + startingConfig.fresh + " days.\n");
  if (preserveProduction) context.writeOutput("Keep Debt Finder in dependencies; do not move it to devDependencies.\n");
  context.writeOutput(installNeeded
    ? "npm will install/repair project dependencies and update package.json/package-lock.json. Lifecycle scripts are disabled.\n"
    : "Reuse the existing compatible local installation and lockfile; no npm install is needed.\n");
  if (!isInteractive(context.env, context.interactive)) {
    throw new Error("Applying team setup requires confirmation in an interactive terminal. Use init --dry-run for inspection. No files changed.");
  }
  if (installNeeded && !declarations.length && !context.packageSpec && context.version === "0.0.0") {
    throw new Error("This development version has not been released. Install a locally packed Debt Finder archive in this repository first, then rerun init. No files changed.");
  }
  const ask = context.confirm ?? confirm;
  if (!await ask("Apply this team setup in \"" + root + "\"?")) throw new SetupCancelledError("Setup cancelled. No files changed.");
  if (scriptConflict && !await ask('Replace the existing debt-finder script with "debt-finder"?')) {
    throw new SetupCancelledError("Script replacement declined. No files changed.");
  }
  if (startingConfig && context.selectStartingConfiguration) {
    startingConfig = validateConfiguration(await context.selectStartingConfiguration());
    context.writeOutput("Selected starting configuration: fresh=" + startingConfig.fresh + " days.\n");
  }
  const assertPlan = async () => {
    if (await readCheckout(localContext) !== originalCheckout) throw new Error("The active checkout changed during setup. Run init again.");
    for (const [name, source] of snapshots) await assertUnchanged(join(root, name), source);
    const current = await inspectSetup(root, localContext);
    if (!isDeepStrictEqual(current, fresh)) throw new Error("Setup state changed during confirmation. Run init again.");
  };
  await assertPlan();
  const scripts = isRecord(pkg.scripts) ? pkg.scripts : {};
  const updated = { ...pkg, scripts: { ...scripts, "debt-finder": "debt-finder" } };
  const packageOutput = isDeepStrictEqual(updated, pkg) && pkgText !== null ? pkgText : formatPackage(updated, pkgText);
  const updateIgnore = fresh.items.some((item) => item.id === "ignore-node_modules" && item.status === "missing");
  if (packageOutput !== pkgText || installNeeded) await assertWritable(join(root, "package.json"));
  if (updateIgnore) await assertWritable(join(root, ".gitignore"));
  if (installNeeded) await assertWritable(join(root, "package-lock.json"));
  let started = false;
  try {
    started = true;
    await writeSetupFile(join(root, "package.json"), packageOutput, pkgText);
    const ignore = snapshots.get(".gitignore")!;
    if (updateIgnore) {
      const newline = ignore?.includes("\r\n") ? "\r\n" : "\n";
      const contents = (ignore ?? "") + (ignore && !ignore.endsWith("\n") ? newline : "") + "node_modules/" + newline;
      await writeSetupFile(join(root, ".gitignore"), contents, ignore);
    }
    if (installNeeded) {
      await assertUnchanged(join(root, "package-lock.json"), snapshots.get("package-lock.json")!);
      await assertUnchanged(join(root, ".npmrc"), snapshots.get(".npmrc")!);
      const args = ["install", "--package-lock=true", "--package-lock-only=false", "--bin-links=true", "--dry-run=false", "--save=true"];
      if (!declarations.length) args.push("--save-dev", "--save-exact", context.packageSpec ?? "debt-finder@" + context.version);
      context.writeOutput("Running npm in " + root + "...\n");
      const result = await npm(args, localContext);
      if (result.code !== 0) throw new Error("npm install failed (exit " + result.code + "). " + result.stderr.trim());
    }
    const currentText = await readSetupFile(join(root, "package.json"));
    if (currentText === null) throw new Error("package.json disappeared during setup.");
    const current = parsePackageObject(currentText);
    if (!isDeepStrictEqual(unrelatedPackageFields(current), unrelatedPackageFields(updated))) {
      throw new Error("Unrelated package.json fields changed during npm installation. Review those changes before retrying.");
    }
    const savedDeclaration = declarations.length ? current[declarations[0]!] : undefined;
    if (originalSpec !== undefined && (!isRecord(savedDeclaration)
      || savedDeclaration["debt-finder"] !== originalSpec)) {
      throw new Error("The existing Debt Finder dependency declaration changed during installation. Review before retrying.");
    }
    if (!await reusableInstallation(root, current, npm, localContext)) throw new Error("npm installation or lockfile verification failed.");
    if (await readCheckout(localContext) !== originalCheckout) throw new Error("The active checkout changed during npm installation.");
    await assertUnchanged(join(root, CONFIG_FILENAME), snapshots.get(CONFIG_FILENAME)!);
    if (startingConfig) await saveConfiguration({ scope: "repository", repositoryRoot: root, path: join(root, CONFIG_FILENAME) },
      startingConfig, null, { allowCreateRepository: true });
    const final = await inspectSetup(root, localContext);
    const remaining = final.items.filter((item) => item.status !== "present"
      && !(item.id === "dependency" && preserveProduction));
    if (remaining.length) throw new Error("Setup still needs attention: " + remaining.map((item) => item.id).join(", "));
    context.writeOutput("Team setup complete. Shared configuration, npm script, dependency, lockfile and ignore rule are ready.\n"
      + "Commit " + CONFIG_FILENAME + ", package.json, package-lock.json and any .gitignore changes. Nothing was staged or committed.\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Setup failed.";
    throw new Error(message + (started
      ? "\nSetup is incomplete. package.json, package-lock.json, .gitignore, configuration or node_modules may have changed. "
        + "Review the files and rerun init after fixing the cause. Dependency changes were not automatically rolled back; nothing was staged or committed."
      : ""));
  }
}
