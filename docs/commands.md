# Commands

Command routing, help, configuration loading/validation, listing, editing, copying, and editor opening are implemented. The full command and validation requirements live in `../Agent.md`.

- `debt-watcher graveyard`: checks repository configuration, offers confirmed team setup/repair during interactive use, scans committed code comments and branch tips across local branches, and prints the filtered report. `--remote` selects fetched remote refs; `--repo` selects another local worktree. Freshness, markers, age bands, ordering and supported filters override saved settings for one run.
- `debt-watcher config --list`: displays the active configuration and its file path; `--list markers` displays the configured markers. Existing personal defaults can be listed with `--global config --list`.
- `debt-watcher config --set key=value`: saves one or more settings after validating the complete result.
- `debt-watcher config --add markers="TO DO,FIXME"` / `--remove markers="HACK"`: updates the marker list without replacing the other entries.
- `debt-watcher --global config --set fresh=60`: edits personal defaults, creating them from the template if missing. All three editing actions support this scope.
- `debt-watcher config`: opens the selected repository config in an editor. `--global config` opens personal defaults and creates them from the template if missing.
- `debt-watcher --global config --copy-from repo`: copies repository settings into personal defaults.
- `debt-watcher config --copy-from global`: copies personal settings into the selected repository config, creating it if missing.
- `debt-watcher init`: inspects the repository, explains changes, and applies team setup after confirmation; `--repo` selects another local checkout.
- `debt-watcher init --dry-run`: keeps the inspection read-only, without prompts or npm calls.

Code-comment and stale-branch reports, type summaries with `--summary` or `--summary types`, author summaries with `--summary blame`, Markdown exports with `--save`, and cached exports with `--save latest` are available. Issue debt remains pending; requesting `type=issues` fails clearly before setup or scanning. Setup can copy personal settings or use the template for a missing config, and opens the resulting config after success. Plain `init` returns exit code 0 after verified setup or a verified no-op; an editor launch failure is reported with a manual path without undoing successful setup. It requires interactive confirmation whenever changes are needed, and returns 1 for cancellation, unresolved conflicts, or failure. `init --dry-run` returns 0 for inspection with only present/missing items and 1 for review/conflict items; preview success does not mean setup is complete. See `installation.md` for first-use behaviour, development-build limitations and failure recovery.

Repository setting edits require existing valid settings. Listing remains read-only. Copies require confirmation before replacing different existing settings; CI and non-interactive invocations fail when confirmation is needed. Opening requires an interactive terminal. See `configuration.md` for examples, validation rules, and first-use personal configuration behaviour.

Use `--help` on the executable or on any command. With no arguments, the executable displays help. `--version` reads the installed package version. Help and version return exit code 0 without requiring a Git repository or configuration.

The routing layer rejects unknown commands and flags, conflicting configuration actions, invalid summary/save/order choices, invalid whole-day inputs, malformed filters and assignments, duplicate filter keys, and incompatible scope options. Report execution merges omitted settings from the active repository config and validates temporary overrides without writing them.

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

`graveyard --summary` prints filtered counts by debt type (code and branches); `--summary blame` groups the same selected findings by blamed code author or branch-tip author, including an Unknown group when needed. Both include the total and oldest match without detailed rows, and can combine with `--save` to write a summary-only Markdown file. Every successful new report or summary replaces a private per-worktree snapshot in user-level storage. `graveyard --save latest` exports that snapshot without rescanning or loading the current repository config; it preserves the original view even after a branch or config change. `--output` selects a file relative to the invocation directory; otherwise the report uses the generation-time `reportDirectory` and a timestamped filename. Missing directories require interactive confirmation to create, or a pre-existing directory in CI. Existing files require interactive overwrite confirmation.

The comment and branch-tip scanners feed the current report. `--filter type=code`, `--filter type=branches`, and a comma-separated combination select report sections. Both scanners use immutable branch snapshots from `src/git/branches.ts`; issue scanning comes later.

The comment scanner's committed-source reading APIs, language extractors, marker matching, and Git blame feed the code section. Extractor selection is internal; no extractor CLI flags or config keys are exposed. See `scanning.md` for scope and limitations.
