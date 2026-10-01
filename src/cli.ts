#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { runCli } from "./program.js";
import { fileURLToPath } from "node:url";
import { isGlobalInstallation } from "./setup/installation.js";

// Resolve package metadata relative to the executable, not the target repository.
const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

process.exitCode = await runCli(process.argv.slice(2), {
  version,
  isGlobalInstallation: () => isGlobalInstallation(fileURLToPath(new URL("..", import.meta.url)), {
    cwd: process.cwd(), env: process.env,
  }),
});
