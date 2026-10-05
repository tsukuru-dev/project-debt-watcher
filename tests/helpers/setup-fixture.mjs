import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n");

// Controlled npm stand-in for failures and race tests; never downloads or executes packages.
export function npmFixture(repo, options = {}) {
  const calls = [];
  const npm = async (args, context) => {
    assert.equal(context.cwd, repo);
    calls.push([...args]);
    if (args[0] === "ls") return { code: 0, stdout: JSON.stringify({
      dependencies: { "debt-finder": { version: "1.2.3" } },
    }), stderr: "" };
    assert.equal(args[0], "install");
    if (options.fail) return { code: 1, stdout: "", stderr: "Simulated registry failure" };
    const pkg = read(join(repo, "package.json"));
    if (!pkg.devDependencies?.["debt-finder"] && !pkg.dependencies?.["debt-finder"]) {
      pkg.devDependencies = { ...pkg.devDependencies, "debt-finder": "^1.2.3" };
    }
    write(join(repo, "package.json"), pkg);
    materialise(repo, pkg);
    return { code: 0, stdout: "", stderr: "" };
  };
  return { calls, npm, packageSpec: "debt-finder@1.2.3" };
}

export function materialise(repo, pkg) {
  const directory = join(repo, "node_modules", "debt-finder");
  mkdirSync(directory, { recursive: true });
  mkdirSync(join(repo, "node_modules", ".bin"), { recursive: true });
  write(join(directory, "package.json"), { name: "debt-finder", version: "1.2.3", bin: { "debt-finder": "cli.js" } });
  writeFileSync(join(directory, "cli.js"), "// fake entry used only for presence checks\n");
  writeFileSync(join(repo, "node_modules", ".bin", process.platform === "win32" ? "debt-finder.cmd" : "debt-finder"), "");
  write(join(repo, "package-lock.json"), { lockfileVersion: 3, packages: {
    "": { ...(pkg.devDependencies ? { devDependencies: pkg.devDependencies } : {}),
      ...(pkg.dependencies ? { dependencies: pkg.dependencies } : {}) },
    "node_modules/debt-finder": { version: "1.2.3" },
  } });
}
