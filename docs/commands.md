# Commands

Command routing and help are implemented. The full command and validation requirements live in `../Agent.md`.

- `debt-watcher graveyard`: routes report, summary, filter, ordering, and save options to the report handler.
- `debt-watcher config`: routes configuration actions to the config handler.
- `debt-watcher init`: routes to the team setup handler.

The handlers currently report that their features are not implemented and return exit code 1. They do not scan, write config, install dependencies, open editors, or create user state. Full validation against saved configuration, supported scanners, and repository paths will arrive with those features.

Use `--help` on the executable or on any command. With no arguments, the executable displays help. `--version` reads the installed package version. Help and version return exit code 0 without requiring a Git repository or configuration.

The routing layer rejects unknown commands and flags, conflicting configuration actions, invalid summary/save/order choices, invalid whole-day inputs, malformed filters and assignments, duplicate filter keys, and incompatible scope options. The command-line day inputs currently accept non-negative whole numbers. Omitted options remain unset so the future configuration layer can supply the saved values.

`--global` selects personal configuration only. `--repo` is passed to the appropriate handler for later repository resolution; it can be used with `--global` only when copying from a repository to personal defaults.

Examples using this development checkout after `npm run build`:

```sh
npm run debt-watcher -- --version
npm run debt-watcher -- graveyard --help
npm run debt-watcher -- config --help
npm run debt-watcher -- init --help
```

`--save latest` exports a cached report without rescanning or changing its view. It must take a separate execution path from new-report generation.

The comment scanner is the first implementation stage. The stale-branch scanner comes next; issue scanners come last. Their future locations are `src/scanners/branches.ts` and `src/scanners/issues/`. The existing `src/git/branches.ts` serves branch selection for comment scanning and is separate from stale-branch detection.
