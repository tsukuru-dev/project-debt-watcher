import type { InitArguments } from "./arguments.js";
import { inspectSetup } from "../setup/inspect.js";
import { applyTeamSetup, printInspection, type TeamSetupContext } from "../setup/team.js";

export type InitContext = TeamSetupContext;

export async function runInit(options: InitArguments, context: InitContext = {
  cwd: process.cwd(), version: "0.0.0", writeOutput: (text) => { process.stdout.write(text); },
}): Promise<void> {
  const inspection = await inspectSetup(options.repo, context);
  printInspection(inspection, context.writeOutput);
  if (options.dryRun) {
    context.writeOutput("Read-only preview. Use init without --dry-run to apply after confirmation.\n"
      + "No files changed, packages installed, editors opened, or Git changes staged.\n"
      + "Package presence is not a compatibility check; npm verification belongs to the apply step.\n");
    if (inspection.items.some((item) => item.status === "conflict" || item.status === "review")) {
      throw new Error("Setup inspection found conflicts or items requiring review. No changes were made.");
    }
    return;
  }
  await applyTeamSetup(inspection, context);
}
