# Commands

Command routing, help, configuration loading/validation, listing, editing, copying, and editor opening are implemented. The full command and validation requirements live in `../Agent.md`.

- `debt-watcher graveyard`: checks repository configuration, offers confirmed team setup/repair during interactive use, scans committed code comments across local branches, and prints the filtered code-only terminal report. `--remote` selects fetched remote refs; `--repo` selects another local worktree. Freshness, markers, age bands, ordering and supported filters override saved settings for one run.
- `debt-watcher config --list`: displays the active configuration and its file path; `--list markers` displays the configured markers. Existing personal defaults can be listed with `--global config --list`.
- `debt-watcher config --set key=value`: saves one or more settings after validating the complete result.
- `debt-watcher config --add markers="TO DO,FIXME"` / `--remove markers="HACK"`: updates the marker list without replacing the other entries.
- `debt-watcher --global config --set fresh=60`: edits personal defaults, creating them from the template if missing. All three editing actions support this scope.
- `debt-watcher config`: opens the selected repository config in an editor. `--global config` opens personal defaults and creates them from the template if missing.
- `debt-watcher --global config --copy-from repo`: copies repository settings into personal defaults.
- `debt-watcher config --copy-from global`: copies personal settings into the selected repository config, creating it if missing.
- `debt-watcher init`: inspects the repository, explains changes, and applies team setup after confirmation; `--repo` selects another local checkout.
- `debt-watcher init --dry-run`: keeps the inspection read-only, without prompts or npm calls.

Code-comment reports, Markdown exports with `--save`, and cached exports with `--save latest` are available. Summary and branch/issue debt remain pending; requesting `--summary` or a branch/issue type filter fails clearly before setup or scanning. Setup can copy personal settings or use the template for a missing config, and opens the resulting config after success. Plain `init` returns exit code 0 after verified setup or a verified no-op; an editor launch failure is reported with a manual path without undoing successful setup. It requires interactive confirmation whenever changes are needed, and returns 1 for cancellation, unresolved conflicts, or failure. `init --dry-run` returns 0 for inspection with only present/missing items and 1 for review/conflict items; preview success does not mean setup is complete. See `installation.md` for first-use behaviour, development-build limitations and failure recovery.

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

`graveyard --save` writes a new Markdown export after scanning. Every successful new report also replaces a private per-worktree snapshot in user-level storage. `graveyard --save latest` exports that snapshot without rescanning or loading the current repository config; it preserves the original report view even after a branch or config change. `--output` selects a file relative to the invocation directory; otherwise the report uses the generation-time `reportDirectory` and a timestamped filename. Missing directories require interactive confirmation to create, or a pre-existing directory in CI. Existing files require interactive overwrite confirmation.

The comment scanner is the first implementation stage. The stale-branch scanner comes next; issue scanners come last. Their future locations are `src/scanners/branches.ts` and `src/scanners/issues/`. The existing `src/git/branches.ts` serves branch selection for comment scanning and is separate from stale-branch detection.

The comment scanner's branch-snapshot and committed-source reading APIs, language extractors, marker matching, and Git blame now feed the code-only `graveyard` report. Extractor selection is internal; no extractor CLI flags or config keys are exposed. See `scanning.md` for scope and limitations.
