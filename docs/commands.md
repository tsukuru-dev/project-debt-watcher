# Commands

Command routing, help, configuration loading/validation, listing, editing, copying, and editor opening are implemented. The full command and validation requirements live in `../Agent.md`.

- `debt-watcher graveyard`: checks repository configuration, offers confirmed team setup/repair during interactive use, then passes report options and saved configuration to the report handler. The scanner is still pending.
- `debt-watcher config --list`: displays the active configuration and its file path; `--list markers` displays the configured markers. Existing personal defaults can be listed with `--global config --list`.
- `debt-watcher config --set key=value`: saves one or more settings after validating the complete result.
- `debt-watcher config --add markers="TO DO,FIXME"` / `--remove markers="HACK"`: updates the marker list without replacing the other entries.
- `debt-watcher --global config --set fresh=60`: edits personal defaults, creating them from the template if missing. All three editing actions support this scope.
- `debt-watcher config`: opens the selected repository config in an editor. `--global config` opens personal defaults and creates them from the template if missing.
- `debt-watcher --global config --copy-from repo`: copies repository settings into personal defaults.
- `debt-watcher config --copy-from global`: copies personal settings into the selected repository config, creating it if missing.
- `debt-watcher init`: inspects the repository, explains changes, and applies team setup after confirmation; `--repo` selects another local checkout.
- `debt-watcher init --dry-run`: keeps the inspection read-only, without prompts or npm calls.

Report generation and saving remain pending. Setup can copy personal settings or use the template for a missing config, and opens the resulting config after success. Plain `init` returns exit code 0 after verified setup or a verified no-op; an editor launch failure is reported with a manual path without undoing successful setup. It requires interactive confirmation whenever changes are needed, and returns 1 for cancellation, unresolved conflicts, or failure. `init --dry-run` returns 0 for inspection with only present/missing items and 1 for review/conflict items; preview success does not mean setup is complete. See `installation.md` for first-use behaviour, development-build limitations and failure recovery.

Repository setting edits require existing valid settings. Listing remains read-only. Copies require confirmation before replacing different existing settings; CI and non-interactive invocations fail when confirmation is needed. Opening requires an interactive terminal. See `configuration.md` for examples, validation rules, and first-use personal configuration behaviour.

Use `--help` on the executable or on any command. With no arguments, the executable displays help. `--version` reads the installed package version. Help and version return exit code 0 without requiring a Git repository or configuration.

The routing layer rejects unknown commands and flags, conflicting configuration actions, invalid summary/save/order choices, invalid whole-day inputs, malformed filters and assignments, duplicate filter keys, and incompatible scope options. The command-line day inputs currently accept non-negative whole numbers. Omitted options remain unset so the future configuration layer can supply the saved values.

`--global` selects personal configuration only. For repository configuration actions, `--repo` selects a local repository or subfolder relative to the invocation's working directory. It can be combined with `--global` only for the repository-to-personal copy action.

Examples using this development checkout after `npm run build`:

```sh
npm run debt-watcher -- --version
npm run debt-watcher -- graveyard --help
npm run debt-watcher -- config --help
npm run debt-watcher -- init --help
npm run debt-watcher -- init --dry-run --repo "../consumer-project"
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

The comment scanner's branch-snapshot and committed-source reading APIs, built-in JavaScript/TypeScript, CSS, Python, Ruby and Go extractors, and official Python/Ruby/Go tool adapters are implemented. They are not yet connected to report generation. Extractor selection is an internal API; no new CLI flags or config keys are exposed in this chunk. The focused Go run passed 64 tests; its real-Go check was skipped because Go is not on PATH. Real-Ruby integration likewise needs a suitable installation. See `scanning.md` for scope and limitations.
