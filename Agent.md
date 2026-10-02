# to-do-graveyard
Your friendly neighbourhood Project debt watcher

## What it does

### Commands

The npm package and executable are both named `debt-watcher`. Group all report actions under the `graveyard` subcommand. Configuration and project setup belong directly under `debt-watcher`. Use the hyphenated spelling consistently; do not expose a standalone `graveyard` executable.

| Action | Command (globally installed executable) |
| --- | --- |
| Detailed report across all local branches | `debt-watcher graveyard` |
| Summary counts by debt type | `debt-watcher graveyard --summary` |
| Summary counts by author | `debt-watcher graveyard --summary blame` |
| All remote branches | `debt-watcher graveyard --remote --all` |
| Temporarily override report settings | `debt-watcher graveyard --fresh 60 --filter includefresh=true` |
| Create or repair team setup | `debt-watcher init` |
| Open the repository config | `debt-watcher config` |
| Permanently change a setting | `debt-watcher config --set fresh=60` |
| List configured markers | `debt-watcher config --list markers` |
| Add markers | `debt-watcher config --add markers="TODO,FIXME"` |
| Remove markers | `debt-watcher config --remove markers="HACK"` |
| Change personal defaults | `debt-watcher --global config --set fresh=60` |
| Copy this repository's settings to personal defaults | `debt-watcher --global config --copy-from repo` |
| Copy personal defaults into this repository | `debt-watcher config --copy-from global` |
| Oldest first / newest first | `debt-watcher graveyard --order oldnew` / `debt-watcher graveyard --order newold` |
| Filter by debt category | `debt-watcher graveyard --filter type=branches` |
| Filter by author | `debt-watcher graveyard --filter author="Alex Smith"` |
| Generate and save a new detailed report | `debt-watcher graveyard --save` |
| Generate and save a type summary | `debt-watcher graveyard --save --summary` |
| Generate and save an author summary | `debt-watcher graveyard --save --summary blame` |
| Save the latest report without rescanning | `debt-watcher graveyard --save latest` |

`git blame` is an internal implementation detail used to collect comment history. Author display is controlled by the `showAuthors` configuration boolean, which defaults to `true`. Detailed reports include authors by default; no `--blame` flag is required. Hiding authors must not disable the Git history lookups needed to calculate ages.

Use the `debt-watcher` command families consistently. Team setup adds the npm script `"debt-watcher": "debt-watcher"`, so locally installed users can run `npm run debt-watcher -- graveyard --summary` or `npm run debt-watcher -- config --set fresh=60`. The standalone `--` passes the remaining arguments through npm to our CLI. Do not create an `npm run graveyard` shortcut or standalone `graveyard` executable.

`npx` also runs locally installed packages; it is not limited to packages that have not been installed. `npx debt-watcher graveyard` uses the project dependency when available, otherwise npm can obtain the package through its cache. A direct `debt-watcher` command requires the executable to be on PATH, normally through global installation.

For `npx`, use `npx debt-watcher graveyard --summary`. The package and executable names match. Do not document `npx graveyard` as a way to fetch our package.

### Temporary overrides and permanent settings

- Report flags override repository configuration for one run only; they never save settings. No `-t` or `--configedit` flag is needed.
- Support `--fresh 60`, `--ageing 60`, `--buried 120`, and `--fossil 365`, with thresholds expressed in days.
- A freshness override by itself uses automatic three-band calculation, overriding saved custom age bands for that run. Explicit age-band flags select custom bands; merge unspecified bands with saved custom values, then reject incomplete or non-ascending thresholds. When freshness and explicit bands are supplied together, use the supplied freshness filter and explicit custom bands.
- Support `--markers TODO,FIXME` as a replacement marker list for the run. Store markers as plain strings without language comment delimiters.
- Support `--filter includefresh=true` and `--filter includefresh=false` to override the saved `includeFresh` boolean for the run. Do not use separate fresh-inclusion flags. This changes inclusion, not the configured day thresholds.
- Support `--repo "../another-project"` to target another local Git repository. Resolve this path against the invocation's working directory, then use the target repository's configuration, setup, and report snapshot. It is a local path, not a request to clone a remote URL.
- Allow report flags to combine, including `--summary`, marker filters, age settings, ordering, debt-type and author filters, and repository selection, except for the incompatible save modes documented below.
- `debt-watcher config` opens the current repository's existing configuration; `debt-watcher init` creates or repairs integration. Do not duplicate these actions with a `--setup` flag.
- Permanent CLI changes use configuration action flags: `--set`, `--add`, `--remove`, `--list`, or `--copy-from`. Permit only one action per invocation. With no action, `debt-watcher config` opens the selected config in the editor.
- `--set key=value` replaces that setting, for example `debt-watcher config --set fresh=60`, `debt-watcher config --set includeFresh=true`, or `debt-watcher config --set showAuthors=false`. Support multiple assignments within a single `--set` action so custom age thresholds can be updated and validated together before any write, for example `debt-watcher config --set fresh=30 ageing=60 buried=120 fossil=365`.
- `debt-watcher config --set markers="TODO,FIXME"` replaces the entire marker list. `--add markers="TODO,FIXME"` appends missing markers without duplicates; `--remove markers="HACK"` removes the listed markers without changing the others. Adding an existing marker or removing an absent one leaves the list unchanged and reports that result.
- `debt-watcher config --list markers` displays the current marker list; `--list` without a key displays all saved settings and the selected configuration file path. Listing must not edit settings or open an editor.
- Treat a quoted comma-separated marker value as one argument, split on commas, trim surrounding whitespace, and preserve spaces inside markers. For example `--add markers="TO DO"` adds one marker, and `--add markers="TO DO,FIXME"` adds two. Reject empty markers; literal commas inside marker names are not supported by this CLI list syntax. Markers contain no language comment delimiters.
- Parse booleans, day thresholds, and marker lists into the appropriate config types. Reject unknown keys, incompatible actions, and invalid resulting settings before writing; preserve unrelated settings and display the updated file path. A permanent freshness change without explicit age-band assignments selects automatic age bands; explicit custom bands must form a complete valid ascending set after merging with saved settings.
- `debt-watcher --global config` selects the personal defaults file. Its action flags operate on that file instead of the repository config and normally require no repository. The exception is copying from a repository, which needs a source repository. `--global` is a configuration scope, not a report option or an instruction to install globally.
- `--repo` selects the target local repository for reports, `init`, repository configuration actions, and saved report lookup. With `--global config --copy-from repo`, it selects the source repository. Reject other combinations of `--global` and `--repo` rather than silently choosing a configuration file.

### Ordering and report filters

- Support `debt-watcher graveyard --order oldnew` for oldest to newest and `--order newold` for newest to oldest. The configuration template sets default `order` to `oldnew`; CLI ordering overrides it for the current run. Reject other order values. Use stable tie-breakers so equal-age findings have predictable ordering.
- Support `--filter type=code`, `--filter type=branches`, and, when issue scanning is implemented, `--filter type=issues`. 
- A comma-separated type list, such as `--filter type=code,branches`, includes either category. Reject unknown or not-yet-implemented categories with a clear message.
- Support `--filter author="Alex Smith"`. Match the supplied text case-insensitively against available author names, emails, or provider usernames. Match the blamed author for code, the last commit author for branches, and the issue author for issues. This filter works even when `showAuthors` is false; missing author data does not match an author filter.
- Allow repeated `--filter` options for different criteria: `debt-watcher graveyard --filter type=code --filter author="Alex" --order newold`. Different criteria combine with AND; values in a type list combine with OR. Reject duplicate filter keys and empty values rather than silently overriding them.
- Apply filters before calculating displayed category counts, total debt, and the oldest matching item. Counts and summary content must describe the filtered results. Reversing the display order must not change which item is reported as the oldest.
- Preserve the report's grouping into code, issues, and branches; order rows within each section. Summary mode uses the same filters. Report metadata and cached snapshots must record the selected filters and order.
- Filters are temporary report options; they do not rewrite configuration. A matching empty result is a valid report with zero counts.

### Summary actions

- `--summary` is a report action flag under `graveyard`, alongside `--filter` and `--save`. It can combine with filters, scope options, and a new-report save. The mutually exclusive configuration-action rule applies to `config`, not to these report actions.
- `debt-watcher graveyard --summary` produces counts grouped by debt type (code, branches, and issues as implemented), total debt, and the oldest matching item, without detailed finding rows. Support `--summary types` as the explicit equivalent.
- `debt-watcher graveyard --summary blame` produces counts grouped by author instead of debt type, plus total debt and the oldest matching item. It summarises the same filtered findings rather than running a different scan. Reject unknown summary modes.
- Attribute code findings to their blamed author, branches to the last commit author, and issues to their author. Group using available author identity metadata, not display name alone when distinct identities are known. Do not guess that identities from different sources belong to the same person. Include unknown authors in an explicit Unknown group so group counts still sum to the report total.
- `showAuthors` controls author display in detailed reports. An explicit `--summary blame` requests author grouping and labels even when `showAuthors` is false.
- Apply the same age, marker, type, author, and fresh-item filters before calculating either summary. The lowercase filter key `includefresh` maps to the config property `includeFresh`; omitted inclusion filters use that saved boolean, initially false. Accept only `true` or `false` for the inclusion filter, and reject duplicate or conflicting values.
- When ordering summary groups, use the age of each group's oldest matching item with the selected `oldnew` or `newold` direction, with a stable group-label tie-breaker. Summary generation must not alter the matched findings or totals.
- Cache and export the selected view, including whether it is detailed, a type summary, or an author summary. `--save --summary` and `--save --summary blame` are valid combinations that generate and save a new summary in one invocation.


### How the system works

the system does the following:

looks at current Git repo -> scans source files -> finds comments in code -> git blame each of them -> get Author date and commit -> calculate age -> filter findings -> sort using the configured order (oldest to newest by default) -> print pretty CLI

### Capabilities and what the report contains

Tool can inspect git remote get-url origin although that has to be done via command where you can apply it to specific branches or all branches on remote etc but by default it applies to all branches on local

Entries contain clickable terminal links + if detect a Github/gitlab remote then generate github/gitlab remote links

Code Total at right side
unresolved comments in code
// TODO:
// FIXME:
// HACK:
// DEPRECATED:
// TEMP:
// WORKAROUND:

CLI to look like:
emoji for how old| days old | code type (clickable) | rest of the comment | author

Issues Total at right side
CLI to look like:
emoji for how old| days old | Issue ID (clickable) | Issue name | author

Stale Branches Total at right side
emoji for how old| last commit days old | last commit ID (clickable) | Branch Name | last commit author

Total debt:
Oldest: Debt type and details
Code count total
Issues count total
Stale Branches count total

Funny line: something like it's probably not temporary anymore but a variety of lines that randomly get used maybe depending on how bad the persons volume of debt vs code count or vs issues or stale branches or it uses how old the oldest is or which category of old has the most eg fossil buried ageing etc

Amount of days freshness and unresolved code comment markers can be modified and editted/stipulated/set up - this can be done in a config file

We provide the template which acts as the defaults which user can edit

as a default we only set the freshness threshold and do the below
Emoji is dictated by oldest graveyard item - stipulated length/3
each third then gets its own emoji demarking it as low medium high
or the user can set up freshness thresholds themselves if they want to be specific and not just set the single freshness filter


So user can either set just the fresh threshold or they can be more specific and set the ageing(💀) buried (🪦) and fossil (🦖) thresholds

CLI overrides are temporary. A freshness-only override uses the /3 rule; explicit custom age-band overrides use their validated thresholds instead.

The configuration must contain an `includeFresh` boolean, set to `false` in the initial/default template. Use `--filter includefresh=true` or `--filter includefresh=false` to override it for one report, without changing age thresholds or saved settings. Use `debt-watcher config --set includeFresh=true` or `includeFresh=false` to persist the choice.

## Saving reports

Provide two distinct save behaviours. By default, generate and save a new detailed report, or a new summary when `--summary` is supplied; no previous report is required:

```sh
debt-watcher graveyard --save
debt-watcher graveyard --save --remote --all
debt-watcher graveyard --save --summary
debt-watcher graveyard --save --summary blame --filter includefresh=false
```

To export a previously generated report without rescanning, use `--save latest`:

```sh
debt-watcher graveyard
debt-watcher graveyard --save latest
```

Both forms support an optional output file path through `--output`:

```sh
debt-watcher graveyard --save --output "./reports/debt-report.md"
debt-watcher graveyard --save latest --output "./reports/debt-report.md"
```

- `debt-watcher graveyard --save` performs a new scan using the current repository configuration and any temporary report overrides, then exports the chosen report view. With no summary action, export detailed tables and the summary; with `--summary`, export the type summary; with `--summary blame`, export the author summary. Configured freshness, marker, and scope filters still apply. Saving does not automatically include fresh items or every remote branch.
- Plain `--save` combines with `--summary` or `--summary blame` and scan options such as `--remote --all`, `--fresh`, `--markers`, `--order`, and `--filter`. It must not require generating a summary separately before saving it.
- `debt-watcher graveyard --save latest` saves the last successfully generated detailed, type-summary, or author-summary report for the target repository without rescanning. Preserve its original generation time, branch scope, filters, order, age values, author visibility, closing line, and exact report view. Changes made to scanning configuration after generation must not alter this snapshot.
- Reject combining `--save latest` with report-changing flags, including `--summary`, `--order`, `--filter`, freshness and age thresholds, marker filters, fresh-item inclusion, or branch scope options. `--output` and `--repo` are allowed because they choose the destination and repository snapshot without changing its content.
- The only explicit save-mode value is `latest`. Reject unknown values and positional output paths; use `--output` for filenames. Reject `--output` without `--save` so a destination is never silently ignored.
- Retain the latest successfully generated report snapshot per repository in a user-level cache outside the repository so it survives separate CLI invocations, including `npx`. A successful new report generation, including plain `--save`, replaces that repository's previous snapshot; `--save latest` does not rescan or change its generation time. Local, global, and `npx` usage must share this behaviour. Do not store snapshots in shared configuration or Git.
- For the first version, export readable UTF-8 Markdown with headings, tables where applicable, emojis, and ordinary links instead of terminal colour or hyperlink escape sequences.
- Include a default report directory in the configuration template, initially `./debt-watcher-reports`. Resolve configured relative directories against the repository root so the setting works for teammates and when the whole repository moves. Also support absolute directory paths valid on the current operating system; document that personal absolute paths are not portable between teammates' machines.
- Without an explicit output file path, save in the configured report directory with a timestamped `debt-watcher-report-<timestamp>.md` filename valid on Windows, macOS, and Linux. Display the full saved path.
- An explicit output file path overrides the configured directory for that save only. Resolve CLI relative paths against the current working directory. Do not silently rewrite the shared configuration for a one-off export.
- Check that the resolved destination directory exists on every save. If it is missing during interactive use, show the full path and offer to create it, retry after the user creates it manually, choose another directory, or cancel. Create directories only after confirmation; create the report file when the destination is ready.
- When the user chooses a different directory, offer to remember it as the default in the shared configuration, explaining that this changes the team's setting. Persist it only after confirmation and successful directory validation or creation, preserving all other settings. Store directories inside the repository as relative paths. Creating the already-configured directory requires no configuration change.
- In non-interactive use, a missing destination directory must produce a clear error with instructions to create it or update the configured path; do not prompt or automatically create it.
- Do not search the filesystem for matching folder names or silently redirect output. Moving the whole repository preserves relative directory settings. If only the report directory moves or is renamed, require an updated path through configuration or the interactive directory selection.
- If the destination path is invalid or cannot be written to, report the specific problem without claiming the report was saved. Preserve the cached report so the user can retry.
- Do not silently overwrite an existing file; request confirmation interactively or fail clearly in non-interactive use. This also applies to a collision with an automatically generated filename.
- If `--save latest` finds no snapshot for the target repository, explain that the user must generate a report first or use plain `debt-watcher graveyard --save`. Never export another repository's report or silently generate a replacement for `--save latest`. Plain `--save` must work without an existing snapshot and it generates graveyard report then saves.
- Exported reports are user-requested files; saving must not automatically stage, commit, or change Git ignore rules for them.

## Compatibility
It should work for the following languages: Python, JS, TS, Node, React, CSS, C/C++, Rust, Go, Django, HTML, Ruby, PHP

The markers should just be text and not include the // because we should be able to understand what the comment symbols will be based on the languages

It should not be that we are scanning the whole repo etc for the text in markers list but rather specifically comment/ comment syntax which means that our system should recognise what syntax is required for each language

### Official language tools and built-in fallbacks

- Prefer official language standard-library or compiler tooling when it exposes a suitable comment-extraction API. Official tools may be separate installations; do not substitute independent third-party parsers such as Babel or Tree-sitter.
- Keep our own language-aware scanners as fallbacks when suitable official tooling is absent or incompatible, and for languages without a suitable official API. A fallback must explicitly report syntax it cannot safely scan; an unscanned file must never be presented as having zero debt.
- Detect existing tools and verify supported versions and required capabilities before selecting an extractor. Do not automatically install runtimes, compiler components, parser packages or dependencies. Discuss proposed development installations with the user first.
- Pass committed source text as data to a fixed extraction helper. Never execute scanned code, import project modules, load project startup hooks, render templates or run project builds to extract comments. Bound subprocess time and output, preserve original text/positions, and leave the checkout unchanged.
- Select an extractor once per scan. If an already selected official tool reports malformed source, crashes, times out or returns invalid output, report that failure instead of silently retrying with the fallback.
- Record the extractor name/version and any fallback reason for future report metadata. Provide explicit official/built-in selection and interpreter selection for reproducible CI; introduce user-facing settings when this is connected to report generation.
- Implement integrations incrementally, starting with Python's standard-library `tokenize`. The initial Python adapter accepts versions 3.12 through 3.14 after a capability probe, retaining our Python lexer as fallback. The fallback must distinguish literal text from expression comments in f-strings and Python 3.14 template strings, including raw prefixes, nesting, reused quotes, debug/conversion fields and format specifiers. Preserve source positions and return explicit diagnostics for malformed lexical structure or exceeded nesting limits. It is a UTF-8 Python 3 comment lexer, not a full grammar validator.
- Ruby follows the same official-tool-first selection using standard-library `Ripper`, with a limited built-in fallback. Initially gate Ruby 3.1-3.4 behind a capability probe; verify real-tool behaviour where Ruby is available and explicitly report skipped integration checks where it is absent. Do not treat unsupported fallback syntax as a debt-free file.
- Go uses the official standard-library `go/scanner` with a built-in comment lexer as fallback. A fixed helper may be compiled from this package's source in disposable temporary storage, with its build cache isolated there, and must be cleaned up after a scan. Never compile or execute the scanned project. Keep comment text and positions from the original committed bytes, including when Go normalizes token text or `//line` remaps display positions. Do not download a Go toolchain or dependencies automatically.

## The build

Build one npm package that supports running through `npx`, local installation, and global installation. The setup and distribution requirements are defined below.

The first thing we will build will be the code check
then we will do the branches
we will do issues last so lets put a pin in that for now

## Build and distribution requirements

- Build one npm CLI package using TypeScript and Node.js.
- Publish compiled JavaScript so users do not need to build the tool.
- Publish the `debt-watcher` package with a single executable named `debt-watcher`.
- Users require Node.js/npm and Git.

### Launch through npx

Support:
- `npx debt-watcher graveyard`
- `npx debt-watcher graveyard --summary`
- `npx debt-watcher graveyard --summary blame`
- `npx debt-watcher graveyard --save`
- `npx debt-watcher graveyard --save --summary`
- `npx debt-watcher graveyard --save --summary blame --filter includefresh=false`
- `npx debt-watcher graveyard --save latest`
- `npx debt-watcher graveyard --order newold --filter type=code`
- `npx debt-watcher config`
- `npx debt-watcher config --set includeFresh=true`
- `npx debt-watcher --global config --set fresh=60`
- `npx debt-watcher init`

This usage must work in Git repositories without a package.json.
Every repository must have a Debt Watcher configuration file before scanning, including when using `npx`. If it is missing during an interactive run, offer the single team setup flow below. If setup is declined, cancel the scan. Non-interactive and CI runs must report missing configuration with setup instructions instead of silently using defaults.
`npx` uses the locally installed package when available; otherwise it can obtain the package through npm's cache. It does not necessarily download the package on every run.

### Install in a project

Support both `npm install debt-watcher` and `npm install --save-dev debt-watcher`. Recommend in readme the development dependency form for team setup because the tool is used during development rather than by the live application.

After installation, the same npx commands must run the local version.

### Global installation

Support `npm install -g debt-watcher`, then the `debt-watcher graveyard`, `debt-watcher config`, and `debt-watcher init` command families from any appropriate repository.

Global, local, and `npx` usage must provide the same scanning features and use the same configuration in the target repository root. Global installation alone does not configure repositories. Accepted setup always creates the team integration, including a local dependency, even when launched through the global executable or `npx`.

### Personal defaults and repository setup state

- Provide a real personal defaults file in a user-level configuration location outside any repository, installed package, and npm cache. Initialise it from the supplied template on the first normal CLI invocation of a global installation, or the first explicit `--global config` command from any installation. Existing personal preferences must never be overwritten by initialisation or package updates. Help and version requests must not create files.
- Users of a global installation must not need to manually create their personal config. Document that file creation occurs on first use so setup works even when npm installation hooks are disabled. Initialising personal defaults must not modify a repository or silently perform team setup.
- `debt-watcher --global config` opens personal defaults; `debt-watcher --global config --set fresh=60` edits them. Support the same listing and marker actions as repository configuration. These commands do not require a repository except when copying from one.
- Offer the same setup behaviour for global, local, and `npx` usage. The following table describes interactive runs; non-interactive and CI behaviour remains governed by the rules below.

| Repository state | Behaviour |
| --- | --- |
| Complete setup with valid repository configuration | Use the repository configuration immediately, without a setup prompt or applying personal defaults. |
| Repository config exists, but team integration is incomplete | Offer to repair the missing integration while preserving the existing repository config and other settings. |
| No repository config; personal defaults exist | Ask whether to copy personal defaults or start from the supplied template, then perform the confirmed team setup and open the new repository config. |
| No repository config or personal defaults | Offer team setup using the supplied template, then open the new repository config. |

- Copy the chosen starting settings into the mandatory repository config; never continuously inherit or link to personal defaults. Subsequent changes to personal defaults must not modify or change the behaviour of existing repository configurations.
- Copy only configuration settings, never machine-specific setup state or cached report snapshots. The repository config remains the shared source of scanning preferences for the team and must be committed to Git.
- Preserve and report invalid existing configuration rather than silently replacing it with personal or supplied defaults.
- Editing personal defaults must not change repository files. Editing repository configuration must not change personal defaults. Explicit copy actions are the only way to transfer existing settings between the two scopes outside initial setup.

### Copying configuration between scopes

```sh
# Current checked-out repository configuration -> personal defaults
debt-watcher --global config --copy-from repo

# Personal defaults -> current checked-out repository configuration
debt-watcher config --copy-from global
```

- Treat copying as a separate configuration action, mutually exclusive with `--set`, `--add`, `--remove`, and `--list`. `copyrepo` and `copyuserglobal` are not configuration keys.
- `--global config --copy-from repo` reads the saved configuration of the target repository's currently checked-out branch/worktree and makes those settings the personal defaults. `--repo` may select another local source repository. Do not copy temporary CLI report overrides.
- `config --copy-from global` writes personal defaults into the target repository's active configuration. `--repo` may select another local destination repository. This changes that branch's working-tree file; it must not change other branches or commit anything automatically.
- Validate the source before writing. Copy the complete supported configuration settings, replacing destination settings rather than concatenating lists or retaining conflicting values. Preserve unrelated metadata and never copy report snapshots, setup state, credentials, or Git/npm files.
- Display the source and destination paths and explain replacement before overwriting an existing config. Require confirmation interactively; fail clearly in non-interactive use if confirmation is needed. A missing or invalid source must produce an error without changing the destination or silently manufacturing a source config. Copy actions validate their source before any first-use config initialisation.
- Preserve relative report-directory settings as relative values; in a repository they resolve against that repository's root. When copying absolute report paths, explain that the resulting setting may be specific to the user's machine before confirming the copy. Copying settings must not create or move report directories.
- These actions copy settings only. They do not install dependencies or repair package integration; any incomplete team setup is handled through the normal setup/repair flow.

### Active branch configuration

- Use the configuration file in the target repository's currently checked-out branch/worktree for the entire report, even when scanning multiple local or remote branches. Do not switch settings for each scanned branch.
- Read the active working-tree config on each invocation, including uncommitted edits saved to disk. A config from the default branch, another branch, an earlier run, or personal defaults must not override it.
- Switching branches may change the tracked config file; the next command must use the file now present in that checkout. Separate Git worktrees use their own checked-out configuration files.
- Configuration edits and copies target the active checkout only. Report generation must not check out branches or alter Git state in order to choose configuration.
- If the active checkout has missing or invalid configuration, follow the documented setup/error rules rather than silently borrowing a config from another branch or personal defaults. Personal defaults may only seed a new repository config through confirmed setup or an explicit copy.
- Record the generating checkout/commit, scanned branch scope, and effective report settings in the snapshot. `--save latest` exports that snapshot unchanged even after a branch switch; display its original context so it is not mistaken for a newly generated report.

### Team dependency installation

- Team setup adds Debt Watcher to the project's dependency list, so teammates get it automatically when they run a normal `npm install` after cloning the repository.
- Record Debt Watcher in `devDependencies` in the project's `package.json`.
- Use npm to install the dependency and generate or update `package-lock.json`; do not manually construct lockfile entries.
- Commit `package.json`, `package-lock.json`, and the shared Debt Watcher configuration. Ignore `node_modules/`.
- Teammates must be able to use the committed setup, including the shared configuration file, without separately installing Debt Watcher or repeating setup. All teammates use the committed scanning rules; CLI overrides apply only to the current run and must not rewrite shared settings.
- Publish the released Debt Watcher package to the npm registry so npm can download it by its published package name(we will do this after build complete). Adding it to a project's dependency list does not publish it.

### Shared configuration and production deployment

- Keep the required Debt Watcher configuration file in the repository root and commit it to Git so the team shares consistent markers, freshness thresholds, and age categories.
- Do not add the configuration file to `.gitignore`. Setup must preserve existing configuration and tell users if Git ignore rules prevent it from being tracked.
- The installation guide must explain which files to commit: the Debt Watcher configuration, `package.json`, and `package-lock.json`. Installed dependencies in `node_modules/` must be ignored by Git.
- Debt Watcher and its configuration are development tooling. Document how to exclude the configuration from production deployment artifacts or live application images using the project's build or deployment rules, while keeping it in the source repository.
- Document omitting development dependencies from the final production runtime installation. Development and CI jobs that run Debt Watcher still need the tool and its configuration.
- Explain that `.gitignore` controls Git tracking, not production deployment, and that omitting development dependencies does not automatically exclude the configuration file. Deployment exclusions depend on the consuming project; setup must not claim to configure every deployment system automatically.
- Users are responsible for configuring their build/deployment pipeline to exclude Debt Watcher and its configuration from the final production artifact or runtime. Keep them available in development and in CI jobs that run Debt Watcher.
- Some build systems already exclude development tooling, so an explicit removal step won’t always be necessary.

### First-run setup and init

Offer setup or repair according to the repository-state table during interactive use. Also provide an explicit command to run setup later:

```sh
npx debt-watcher init
```

Globally installed users can run `debt-watcher init`. Users do not need to run `init` separately if they accept setup on first use or their repository already contains a valid configuration.

Provide one setup flow: team setup. Explain the configuration, npm dependency, `debt-watcher` npm script, package-file, and Git ignore changes, then ask for confirmation. Accepting performs setup and opens the configuration. Declining makes no project changes; if required configuration is missing, cancel the scan. Declining integration repair may leave scanning available through an already installed tool when the repository config is valid. Do not offer a separate configuration-only setup mode.

Setup must create files in the repository being configured, not in the installed package or npm cache. Use the supplied template or a copy of personal defaults chosen as described above, then open the file for editing rather than ask a questionnaire about each setting. If opening the editor fails, display the configuration's full path. Existing configuration must be reused and preserved.

Team setup must:

- Create the editable repository configuration from the chosen starting settings when one does not exist. The supplied template sets `fresh` to `30` days, `includeFresh` to `false`, `showAuthors` to `true`, and `order` to `oldnew`.
- Create a minimal `package.json` when none exists, including in Python, Go, and other non-Node repositories. Set `"private": true` only in a newly created package.json to prevent accidental npm publication of that project; preserve an existing project's setting.
- Add Debt Watcher as a local development dependency using npm, updating the package files and lockfile. Reuse an existing compatible local installation without unnecessary reinstallation or silently changing its dependency classification.
- Add `"debt-watcher": "debt-watcher"` to the project's npm scripts, preserving other scripts and asking before replacing a conflicting value. Do not add a script named `graveyard`. Reuse an already matching script without changing it.
- Ensure `node_modules/` is ignored by Git, creating or updating `.gitignore` while preserving existing entries. Do not ignore the shared configuration or package files.
- Preserve unrelated package.json fields, dependencies, scripts, and configuration.
- Ask before replacing conflicting scripts or existing configuration; without confirmation, preserve them. In non-interactive use, report conflicts without overwriting them.
- Be safe to run repeatedly, leaving matching scripts and existing settings unchanged.
- Explain that the configuration and both package files should be committed so teammates can run `npm install` and use the same setup. Do not automatically stage or commit files.

After successful first-run setup, continue the originally requested report using the repository configuration. Subsequent runs with complete setup go straight to reporting. Remember declined automatic setup or repair offers per repository in user-level settings instead of repeatedly prompting. Later runs with missing required configuration should give a concise instruction to run `init`; valid existing configuration can still be used after a declined integration repair. Explicit `init` must remain available regardless of a previous cancellation.

The generated npm script exposes all command families through the locally installed executable:

```json
{
  "scripts": {
    "debt-watcher": "debt-watcher"
  }
}
```

```sh
npm run debt-watcher -- graveyard
npm run debt-watcher -- graveyard --summary
npm run debt-watcher -- graveyard --save --summary blame --filter includefresh=false
npm run debt-watcher -- config --set fresh=60
npm run debt-watcher -- --global config --set fresh=60
```

These are the same CLI operations available through `npx debt-watcher ...` or a globally available `debt-watcher ...`. npm runs the project's script and passes the arguments following the standalone `--` to our executable; there is no separate command interface for team installations.

CI and non-interactive report runs must not prompt, open an editor, install dependencies, or generate missing repository or personal configuration. They use the committed repository configuration and already installed tooling; missing required repository configuration produces a clear error. Missing personal defaults must not block an otherwise configured CI scan. Explicit personal config-editing commands may initialise their target defaults file, subject to validation and overwrite rules.

Installing the tool must not automatically modify the project's scripts or create configuration through npm installation hooks. Repository changes belong to the confirmed first-run setup or explicit `init` flow. Users may also prepare the required repository configuration manually. Personal defaults are initialised on first use as described above.

### Development and release

Provide commands to build and test the tool locally.
Verify the packaged CLI before publishing to npm.
