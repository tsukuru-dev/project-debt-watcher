# Commands

Command routing, help, configuration loading/validation, listing, editing, copying, and editor opening are implemented. The full command and validation requirements live in `../Agent.md`.

- `debt-watcher graveyard`: routes report, summary, filter, ordering, and save options to the report handler.
- `debt-watcher config --list`: displays the active configuration and its file path; `--list markers` displays the configured markers. Existing personal defaults can be listed with `--global config --list`.
- `debt-watcher config --set key=value`: saves one or more settings after validating the complete result.
- `debt-watcher config --add markers="TO DO,FIXME"` / `--remove markers="HACK"`: updates the marker list without replacing the other entries.
- `debt-watcher --global config --set fresh=60`: edits personal defaults, creating them from the template if missing. All three editing actions support this scope.
- `debt-watcher config`: opens the selected repository config in an editor. `--global config` opens personal defaults and creates them from the template if missing.
- `debt-watcher --global config --copy-from repo`: copies repository settings into personal defaults.
- `debt-watcher config --copy-from global`: copies personal settings into the selected repository config, creating it if missing.
- `debt-watcher init`: performs a read-only setup inspection and previews missing pieces and conflicts; `--repo` selects another local checkout.

Report generation and applying team setup remain pending. `init` currently prints an inspection only: no prompts, file changes, installations, editor launches, or Git writes. It returns exit code 0 for a successful inspection with only present/missing items, and 1 for conflicts, review items, or inspection errors. Exit code 0 does not mean setup has been applied. Repository setting edits require existing valid settings. Listing remains read-only. Copies require confirmation before replacing different existing settings; CI and non-interactive invocations fail when confirmation is needed. Opening requires an interactive terminal. See `configuration.md` for examples, validation rules, and first-use personal configuration behaviour.

Use `--help` on the executable or on any command. With no arguments, the executable displays help. `--version` reads the installed package version. Help and version return exit code 0 without requiring a Git repository or configuration.

The routing layer rejects unknown commands and flags, conflicting configuration actions, invalid summary/save/order choices, invalid whole-day inputs, malformed filters and assignments, duplicate filter keys, and incompatible scope options. The command-line day inputs currently accept non-negative whole numbers. Omitted options remain unset so the future configuration layer can supply the saved values.

`--global` selects personal configuration only. For repository configuration actions, `--repo` selects a local repository or subfolder relative to the invocation's working directory. It can be combined with `--global` only for the repository-to-personal copy action.

Examples using this development checkout after `npm run build`:

```sh
npm run debt-watcher -- --version
npm run debt-watcher -- graveyard --help
npm run debt-watcher -- config --help
npm run debt-watcher -- init --help
npm run debt-watcher -- init --repo "../consumer-project"
# With a configuration file already present at the target repository root:
npm run debt-watcher -- config --list
npm run debt-watcher -- config --list markers
npm run debt-watcher -- config --set fresh=60 includeFresh=true
npm run debt-watcher -- config --add markers="TO DO"
npm run debt-watcher -- config
npm run debt-watcher -- --global config --copy-from repo
npm run debt-watcher -- config --copy-from global
```

`--save latest` exports a cached report without rescanning or changing its view. It must take a separate execution path from new-report generation.

The comment scanner is the first implementation stage. The stale-branch scanner comes next; issue scanners come last. Their future locations are `src/scanners/branches.ts` and `src/scanners/issues/`. The existing `src/git/branches.ts` serves branch selection for comment scanning and is separate from stale-branch detection.
