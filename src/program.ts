import { Command, CommanderError, InvalidArgumentError, Option } from "commander";
import {
  nonEmpty,
  parseDays,
  parseFilter,
  parseMarkers,
  validateConfig,
  validateGraveyard,
  validateScope,
  type ConfigArguments,
  type GraveyardArguments,
  type InitArguments,
} from "./commands/arguments.js";
import { runConfig, type ConfigurationInteraction } from "./commands/config.js";
import { runGraveyard } from "./commands/graveyard.js";
import { runInit } from "./commands/init.js";
import type { TeamSetupContext } from "./setup/team.js";
import { prepareReportRepository, type PreparedRepository } from "./setup/flow.js";
import { initialisePersonalDefaults } from "./setup/defaults.js";
import { isInteractive } from "./terminal/prompts.js";

export interface CommandHandlers {
  graveyard(options: GraveyardArguments): void | Promise<void>;
  config(options: ConfigArguments): void | Promise<void>;
  init(options: InitArguments): void | Promise<void>;
}

export interface CliOptions {
  version: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  handlers?: Partial<CommandHandlers>;
  terminal?: ConfigurationInteraction;
  setup?: Pick<TeamSetupContext, "npm" | "packageSpec" | "startingConfiguration">;
  isGlobalInstallation?: () => Promise<boolean>;
  /** Report implementation boundary; setup finishes before dispatching original arguments. */
  report?: (options: GraveyardArguments, repository?: PreparedRepository) => Promise<void>;
}

function createProgram(options: CliOptions): Command {
  const writeOutput = options.stdout ?? ((text: string) => { process.stdout.write(text); });
  const context = {
    cwd: options.cwd ?? process.cwd(), env: options.env ?? process.env,
    version: options.version, writeOutput, ...options.terminal, ...options.setup,
    ...(options.homeDirectory === undefined ? {} : { homeDirectory: options.homeDirectory }),
  };
  const initialise = async () => {
    if (isInteractive(context.env, context.interactive) && await options.isGlobalInstallation?.()) {
      try { await initialisePersonalDefaults(context); }
      catch (error) {
        writeOutput("Could not initialise personal defaults: " + (error instanceof Error ? error.message : "Unknown error.") + "\n");
      }
    }
  };
  const handlers: CommandHandlers = {
    graveyard: async (values) => {
      // Exporting a cached report must not initialise or repair a changed checkout.
      if (values.save === "latest") return (options.report ?? runGraveyard)(values);
      await initialise();
      const repository = await prepareReportRepository(values, context);
      await (options.report ?? runGraveyard)(values, repository);
    },
    config: async (values) => {
      await runConfig(values, context);
      if (values.list === undefined && values.copyFrom === undefined && !values.global) await initialise();
    },
    init: async (values) => {
      if (!values.dryRun) await initialise();
      await runInit(values, context);
    },
    ...options.handlers,
  };
  const program = new Command()
    .name("debt-watcher")
    .description("Your friendly neighbourhood project debt watcher.")
    .version(options.version, "-V, --version", "Display the installed package version")
    .option("--global", "Select personal defaults (config only)")
    .option("--repo <path>", "Select another local Git repository", nonEmpty)
    .configureHelp({ showGlobalOptions: true })
    .configureOutput({
      writeOut: writeOutput,
      writeErr: options.stderr ?? ((text) => { process.stderr.write(text); }),
    })
    .showHelpAfterError("Run 'debt-watcher --help' for usage.")
    .exitOverride()
    .addHelpText("after", "\nConfiguration, team setup and first-use setup are available. Report generation and saving are not implemented yet.");

  program.command("graveyard")
    .description("Generate or save a detailed report or summary (implementation pending)")
    .addOption(new Option("--summary [mode]", "Summarise by types (default) or blame")
      .choices(["types", "blame"]).preset("types"))
    .addOption(new Option("--save [mode]", "Save a new report, or export the latest snapshot")
      .choices(["latest"]))
    .option("--output <file>", "Destination filename; requires --save", nonEmpty)
    .option("--remote", "Scan remote branch refs")
    .option("--all", "Include all branches in the selected scope")
    .option("--fresh <days>", "Override the freshness threshold for this run", parseDays)
    .option("--ageing <days>", "Override the ageing threshold for this run", parseDays)
    .option("--buried <days>", "Override the buried threshold for this run", parseDays)
    .option("--markers <list>", "Replace markers for this run (comma-separated)", parseMarkers)
    .addOption(new Option("--order <direction>", "Order results oldest/newest first")
      .choices(["oldnew", "newold"]))
    .option("--filter <key=value>", "Filter by type, author, or includefresh; repeat for different keys", parseFilter)
    .addHelpText("after", [
      "",
      "Examples:",
      "  debt-watcher graveyard --save --summary blame --filter includefresh=false",
      "  debt-watcher graveyard --save latest --output ./reports/debt.md",
      "",
      "--save latest allows --output and --repo, but cannot change the cached report.",
    ].join("\n"))
    .action(async (_localOptions, command: Command) => {
      const values = command.optsWithGlobals<GraveyardArguments>();
      validateGraveyard(values);
      await handlers.graveyard(values);
    });

  const config = program.command("config")
    .description("Open, inspect, edit, or copy configuration settings");
  const actions = [
    new Option("--set <key=value...>", "Replace one or more settings together"),
    new Option("--add <key=value>", "Add markers without replacing the list"),
    new Option("--remove <key=value>", "Remove markers without replacing the list"),
    new Option("--list [key]", "List saved settings, or one setting").argParser(nonEmpty),
    new Option("--copy-from <source>", "Replace settings using the other configuration scope")
      .choices(["repo", "global"]),
  ];
  for (const action of actions) {
    config.addOption(action.conflicts(
      actions.filter((other) => other !== action).map((other) => other.attributeName()),
    ));
  }
  config.addHelpText("after", [
    "",
    "Choose only one action. Listing is read-only; repository edits require an existing config.",
    "An explicit --global edit creates missing personal defaults from the supplied template.",
    "With no action, open the selected config in an editor (interactive terminals only).",
    "Copies replace settings, preserving destination metadata; existing settings require confirmation.",
    "Examples:",
    "  debt-watcher config --set fresh=30 ageing=60 buried=120",
    '  debt-watcher config --add markers="TO DO,FIXME"',
    "  debt-watcher --global config --set fresh=30",
    "  debt-watcher --global config --copy-from repo",
    "  debt-watcher config --copy-from global",
  ].join("\n"))
    .action(async (_localOptions, command: Command) => {
      const values = command.optsWithGlobals<ConfigArguments>();
      validateConfig(values);
      await handlers.config(values);
    });

  program.command("init")
    .description("Inspect and apply team setup after confirmation")
    .option("--dry-run", "Preview setup without prompts, npm calls, or file changes")
    .action(async (_localOptions, command: Command) => {
      const values = command.optsWithGlobals<InitArguments>();
      validateScope("init", values);
      await handlers.init(values);
    });

  return program;
}

/** Run one invocation without exiting the process, so routing can be tested in isolation. */
export async function runCli(args: readonly string[], options: CliOptions): Promise<number> {
  const program = createProgram(options);
  try {
    await program.parseAsync(args.length ? args : ["--help"], { from: "user" });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError && !(error instanceof InvalidArgumentError)) {
      // Commander has already printed parser errors, help, or version output.
      return error.exitCode;
    }
    const message = error instanceof Error ? error.message : "An unexpected error occurred.";
    const writeError = options.stderr ?? ((text: string) => { process.stderr.write(text); });
    writeError(`error: ${message}\n`);
    return 1;
  }
}
