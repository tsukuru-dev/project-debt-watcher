# Commands

Command routing, help, configuration loading/validation, and configuration listing are implemented. The full command and validation requirements live in `../Agent.md`.

- `debt-watcher graveyard`: routes report, summary, filter, ordering, and save options to the report handler.
- `debt-watcher config --list`: displays the active configuration and its file path; `--list markers` displays the configured markers. Existing personal defaults can be listed with `--global config --list`.
- `debt-watcher init`: routes to the team setup handler.

Report generation, configuration editing/copying, editor opening, and team setup still report that they are not implemented and return exit code 1. Listing works with existing files and does not write configuration, install dependencies, open editors, or create user state. See `configuration.md` for the file format and missing-file behaviour.

Use `--help` on the executable or on any command. With no arguments, the executable displays help. `--version` reads the installed package version. Help and version return exit code 0 without requiring a Git repository or configuration.

The routing layer rejects unknown commands and flags, conflicting configuration actions, invalid summary/save/order choices, invalid whole-day inputs, malformed filters and assignments, duplicate filter keys, and incompatible scope options. The command-line day inputs currently accept non-negative whole numbers. Omitted options remain unset so the future configuration layer can supply the saved values.

`--global` selects personal configuration only. For repository listings, `--repo` selects a local repository or subfolder relative to the invocation's working directory. It can be combined with `--global` only for the planned repository-to-personal copy action.

Examples using this development checkout after `npm run build`:

```sh
npm run debt-watcher -- --version
npm run debt-watcher -- graveyard --help
npm run debt-watcher -- config --help
npm run debt-watcher -- init --help
# With a configuration file already present at the target repository root:
npm run debt-watcher -- config --list
npm run debt-watcher -- config --list markers
```

`--save latest` exports a cached report without rescanning or changing its view. It must take a separate execution path from new-report generation.

The comment scanner is the first implementation stage. The stale-branch scanner comes next; issue scanners come last. Their future locations are `src/scanners/branches.ts` and `src/scanners/issues/`. The existing `src/git/branches.ts` serves branch selection for comment scanning and is separate from stale-branch detection.
