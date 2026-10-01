# Installation

The TypeScript build, configuration commands, setup inspection, and confirmed application of team setup are implemented. Reports and the automatic first-use setup experience remain future build stages.

The package uses one executable named `debt-watcher`. This build targets Node.js 22 or newer. npm is needed for installation. Git locates repository configuration and will also be used for scanning; personal configuration actions need no Git repository except when copying from one. See `../Agent.md` for the complete requirements.

From this package's source directory:

```sh
npm ci
npm run build
npm run typecheck
npm test
npm run debt-watcher -- --help
npm run debt-watcher -- graveyard --help
npm run debt-watcher -- --global config --help
```

`build` compiles `src/` into `dist/`. `typecheck` checks types without emitting files. `test` builds first, then runs Node's built-in test runner against the compiled code. The tests cover routing, config validation/listing/editing, help/version output, and an offline installation of the packaged CLI, including first-use personal configuration. Configuration tests create temporary Git repositories and isolated personal-settings directories to check persistence, branch and worktree behaviour. Test folders are removed after use.

The development `debt-watcher` script runs `node dist/cli.js` so changes can be tried without a global installation or fetching a published package. Rebuild after changing TypeScript source. Consumer projects will receive the script `"debt-watcher": "debt-watcher"` during team setup; that script uses their installed executable.

`npm run debt-watcher -- --global config` creates missing personal defaults and opens them in an interactive terminal. Installation itself does not create them. Configure `VISUAL` or `EDITOR` to choose an editor; Windows values should point to an executable (`.exe`), not a batch wrapper. See `configuration.md` for editor defaults and configuration copying.

Commander is the runtime command-line parser. TypeScript and Node.js type definitions are development dependencies. npm maintains `package-lock.json`; do not hand-edit it. There are no installation hooks that create configuration or change another project's files.

For consuming projects, confirmed team setup creates or reuses the shared config, adds the local development dependency and `debt-watcher` npm script, and lets npm update the package files. Commit the shared config, `package.json`, `package-lock.json`, and any `.gitignore` changes; ignore `node_modules/`.

## Preview team setup

From this development checkout, inspect a separate consumer repository:

```sh
npm run debt-watcher -- init --dry-run --repo "../consumer-project"
```

The inspection locates the selected worktree root and reports:

- Shared config validity and whether it needs creating.
- Missing or invalid `package.json`, dependency declarations, and matching or conflicting npm scripts.
- Repository-local Debt Watcher package metadata and the lockfile entry.
- Effective Git ignore rules for `node_modules/` and the shared config/package files, including negations and machine-level exclusions.
- Tracked `node_modules` files and workflows needing review, such as workspaces, another package manager, or `npm-shrinkwrap.json`.

`PRESENT` means an inspected entry exists and passes the checks above. `MISSING` describes a proposed addition; `CONFLICT` and `REVIEW` identify decisions or corrections needed before applying setup. Dependency compatibility, executable integrity, and full lockfile consistency are deliberately left to npm verification in the apply step. Inspection never executes npm or project scripts, contacts the registry, creates personal defaults, or changes files.

The preview is safe to repeat in interactive terminals or CI. Exit code 0 means inspection succeeded with no conflicts/review items, even if setup is missing; it does not certify that the repository is fully configured. Exit code 1 signals inspection errors or review items. Inspecting Debt Watcher's own source package reports a self-dependency conflict; use a separate consumer repository for setup.

## Apply team setup

```sh
npm run debt-watcher -- init --repo "../consumer-project"
```

Plain `init` shows the inspection and planned changes, then asks for confirmation. A conflicting `debt-watcher` npm script requires a separate confirmation before any writes. Declining either prompt leaves the project unchanged. Existing valid config and unrelated package fields are preserved. A new manifest gets `"private": true`; an existing private setting is never changed.

New configuration currently uses the bundled 30-day template. Personal-default selection, opening the config after setup, and first-use report continuation belong to the next build chunk. Existing personal defaults are not altered.

New dependencies use the released CLI's exact version in `devDependencies`. Existing Debt Watcher declarations in `dependencies` are preserved rather than silently moved. Optional-only, peer-only, duplicate declarations, other package-manager lockfiles, workspaces, shrinkwrap, ignored shared files, and linked installation directories require manual resolution first. On Windows, paths containing `&` are also flagged because npm's generated command shims can fail there.

Setup checks the installed package, executable entry and npm shortcut, lockfile version/spec agreement, and npm's dependency-tree validation before reusing an installation. A complete setup is a no-op, including in CI. Changes require an interactive terminal; use `--dry-run` for a non-interactive preview.

When installation is needed, npm runs in the selected repository and generates/updates the lockfile. It may install or reconcile the project's other dependencies as well. Lifecycle scripts are disabled during this setup operation; projects that need native builds or other install hooks can run their normal npm workflow separately. The tool never hand-constructs lock entries, stages files, commits, or removes tracked `node_modules` files.

Setup rechecks the checkout and file contents after confirmation. If npm or later verification fails, the command returns an error and describes possible partial changes. It does not claim success or attempt to undo npm's dependency changes. Review the working-tree changes, fix the cause, and rerun `init`. Existing valid configuration is preserved; missing config is created only after dependency verification.

## Testing before publication

This package is still at development version `0.0.0`. Setup refuses to fetch that version as a new registry dependency. The integration tests pack our actual build into a local archive, apply setup in a temporary consumer repo using that archive, check repeat runs and npm script execution, and verify a fresh consumer can install from the generated lockfile. These tests run offline and do not install globally.

For a manual development check, install a locally packed archive into a separate consumer repository first, then run `init` there to complete the shared config/script/ignore integration. Local archive paths are development fixtures, not a substitute for a published package in the team's final committed dependency list.

`npm pack` builds through `prepack` and produces an archive containing compiled JavaScript, the configuration template, package metadata, and npm's automatically included documentation. It does not publish the package. The template is valid and currently sets freshness to 30 days; see `configuration.md` for manual setup while automatic setup is pending.

`dist/` is generated by the build, not maintained by hand. Runtime installations need Commander and the compiled JavaScript; they do not need TypeScript.
