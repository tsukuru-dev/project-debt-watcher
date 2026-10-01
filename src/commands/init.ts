import type { SharedArguments } from "./arguments.js";
import { inspectSetup } from "../setup/inspect.js";
import type { GitContext } from "../git/client.js";

export interface InitContext extends GitContext {
  writeOutput: (text: string) => void;
}

export async function runInit(options: SharedArguments, context: InitContext = {
  cwd: process.cwd(), writeOutput: (text) => { process.stdout.write(text); },
}): Promise<void> {
  const inspection = await inspectSetup(options.repo, context);
  const lines = [
    "Setup inspection: " + inspection.repositoryRoot,
    "Read-only preview. Applying setup is not implemented yet.",
    "",
    ...inspection.items.map((item) => "[" + item.status.toUpperCase() + "] " + item.message),
    "",
    "No files changed, packages installed, editors opened, or Git changes staged.",
    "Package presence is not a compatibility check; npm verification belongs to the apply step.",
  ];
  context.writeOutput(lines.join("\n") + "\n");
  if (inspection.items.some((item) => item.status === "conflict" || item.status === "review")) {
    throw new Error("Setup inspection found conflicts or items requiring review. No changes were made.");
  }
}
