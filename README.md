# Project Debt Watcher

Your friendly neighbourhood project debt watcher. Dig up forgotten TODOs, unresolved issues [coming soon], and stale branches before they become fossils.

Want to help? See [CONTRIBUTING.md](https://github.com/tsukuru-dev/project-debt-watcher/blob/main/CONTRIBUTING.md) for issues, pull requests, and development steps.

Contents:
- [What it does](#what-it-does)
- [Further functionality](#further-functionality)
- [Set up](#set-up)
- [Technical specs](#technical-specs)
- [Commands](#commands)
- [How it works](#how-it-works)
- [Current scope](#current-scope)
- [License](#license)

## What it does

Project Debt Watcher is a command-line tool for Git repositories. Its `graveyard` report currently brings together different types of project debt:

- **Code comments:** unresolved comments (markers) such as `TODO`, `FIXME`, and `WORKAROUND` in code.
- **Issues:** unresolved repository issues, with links to their original discussions. [coming soon]
- **Stale branches:** named branches whose latest commit is old.

Reports will show items from oldest to newest, making it easier to spot work that has been left behind.

GitHub and GitLab issue reporting is planned. The default detailed report has separate code and branch sections, each ordered oldest first. It shows ages, comment or commit details, and authors when enabled. It does not change your checkout.

### Code comments
Debt Watcher finds ageing `TODO`, `FIXME`, and other configured markers in committed source comments.

These can be configured based on your needs using the config file.

### Stale branches
Debt watcher finds lost branches by looking at latest commit dates. It reports ages and authors without changing your checkout.

### Reporting and filters
The default `graveyard` report groups detailed findings by type, with code and branch sections. Use `--group author` for author sections or `--group age` for Fresh, Ageing, Buried, and Fossil sections. Filters select findings before grouping; summaries show counts by type or author. Issue reporting is planned.

Essentially commands exist that support the following:
- showing all items including fresh items
- grouping by type, age categories or authors
- filtered reports so you only see, for example, a specific author or debt type.

**Age categories:** these thresholds for ageing (💀), buried (🪦), and fossil (🦖) items. Age categories have been configured as defaults (these are editable in the config file).

## Further Functionality
This package is meant to be felxible to the user and allow for reporting as needed by the user with easy defaults in place.

### Age categories and how they work
Each threshold is an **inclusive maximum**. The default template configuration uses:

| Category | Config File | Age in days |
| --- | --- | ---: |
| 🌱 Fresh | `fresh: 30` |0–30 |
| 💀 Ageing | `ageing: 60` | 31–60 |
| 🪦 Buried | `buried: 90` | 61–90 |
| 🦖 Fossil | not in file as uses `buried` | 91+ |

Fresh findings are excluded by default. `fossil` has no separate number: anything older than the `buried` maximum is fossil. You can edit the three thresholds in the shared config. Setting only `fresh` through the CLI, without also supplying `ageing` and `buried`, selects automatic bands for the non-fresh range; the saved config remains unchanged.

A freshness threshold supplied through the CLI will temporarily override the configured thresholds for that run and use the automatic three-band calculation. It will leave the saved configuration unchanged.

Unless you are setting it in config through command. To change a saved setting, use `config --set`.

### Links
In terminal reports, a code location opens the local file when its bytes match the scanned commit. VS Code terminal links go to the flagged line; other terminals use the operating system's file handler, whose editor and line behavior can vary. If the local file differs, a recognised GitHub or GitLab remote supplies a link to the exact committed line instead. Branch commit IDs link to their commit pages. Saved Markdown uses portable web links where available. If a commit has not been pushed, its web link may not resolve yet.

### Saving Reports
Any report can be saved with `--save` added to the command.

Add `--save` to generate and save a new report, including a summary if you requested one. `--save latest` exports the last successfully generated report for that repository without rescanning. Use `--output ./report.md` to choose a filename and directory; otherwise Debt Watcher uses the configured `reportDirectory` and a timestamped filename. If a destination directory is missing, interactive use offers to create it or choose another; non-interactive use fails clearly. An existing file is never silently overwritten.

## Set up
**Using `npx` still requires Node.js and npm**; it does not require a separate global installation of Debt Watcher.

For a shared team setup, run the CLI in an interactive terminal from your repository:
```sh
npx debt-watcher init
```

`init` inspects the repository, explains any missing or broken setup, and asks before changing project files. It creates or reuses `debt-watcher.config.json`, records an exact development dependency in `package.json`, updates `package-lock.json`, adds a `debt-watcher` npm script, and ensures `node_modules/` is ignored. It creates a minimal `package.json` for a non-Node project if needed. Existing settings and unrelated package fields are preserved. When required integration needs manual attention, it reports that instead of replacing it silently. After setup, it opens the config in an editor. Preview the plan without changing files with `npx debt-watcher init --dry-run`.

The repository config `debt-watcher.config.json` is required for scanning and reports. If it is missing, an interactive first report can offer the same confirmed setup. CI and other non-interactive runs require a valid existing config and installed tooling; they do not prompt or run setup.

After team setup, the repository also has an npm script. Use `npm run debt-watcher -- graveyard` if you prefer it to `npx debt-watcher graveyard`; the `--` passes arguments through npm to the executable.

### Installation and team files
You can also install first with `npm install --save-dev debt-watcher`, or install globally with `npm install -g debt-watcher`. 

Installation alone does not set up a repository; use `debt-watcher init` (or `npx debt-watcher init`) there. A global installation uses the same repository config, and can also keep personal defaults that seed new team setups. `npx` uses a local installation when available.

Commit `debt-watcher.config.json`, `package.json`, and `package-lock.json` so everyone shares the same setup. Keep `node_modules/` ignored. 

The config and this tool are development tooling: exclude them from production artifacts, but keep them in any CI job that runs Debt Watcher.

### Repository config and personal config defaults
The repository config controls reports for that repository. When scanning several branches, Debt Watcher uses the config in the **currently checked-out worktree** for the whole report. A global installation can also keep a personal defaults file. Those defaults are a starting point for new repositories; they do not override an existing repository config.

If personal defaults exist when a new repository config is needed, setup asks whether to **copy** them or use the supplied template. The copy is independent: later changes to your personal file do not alter the team's file. You can explicitly copy settings between scopes with `config --copy-from`, which asks before replacing an existing destination. `debt-watcher --global config` edits personal defaults; ordinary `debt-watcher config` edits the repository file.


### Configuration file
The supplied configuration template contains editable defaults:

- **Comment markers:** which unresolved code comments to include.
- **Freshness threshold:** the number of days used to filter ageing debt.
- **Age categories:** thresholds for ageing (💀), buried (🪦), and fossil (🦖) items.

A freshness threshold supplied through the CLI will temporarily override the configured thresholds for that run and use the automatic three-band calculation. It will leave the saved configuration unchanged. (Unless using the `set` command with `config`)

Current defaults are as follows:
```json
{
  "fresh": 30,
  "ageing": 60,
  "buried": 90,
  "markers": [
    "TODO",
    "FIXME",
    "HACK",
    "DEPRECATED",
    "TEMP",
    "WORKAROUND"
  ],
  "includeFresh": false,
  "showAuthors": true,
  "order": "oldnew",
  "reportDirectory": "./debt-watcher-reports"
}
```

## Technical Specs
The package supports multiple languages. Can be used using `npx` or `npm` and can be installed globally.

```sh
npx debt-watcher init
npx debt-watcher graveyard
```

```sh
npm install --save-dev debt-watcher
npm run debt-watcher -- graveyard
```

install globally with
```sh
npm install -g debt-watcher
debt-watcher graveyard
```

### Supported languages
Supported source families include JavaScript/TypeScript (including JSX/TSX), Python, Ruby, Go, Rust, PHP, C/C++, CSS, HTML, and Django templates. Debt Watcher uses built-in comment scanners, with optional support from compatible language tools already installed on your machine. It does not install those tools.

### Reqirements
- Node.js 22 or newer
- npm
- Git 2.45 or newer
- Git repository.

Commit `debt-watcher.config.json`, `package.json`, and `package-lock.json` so teammates get the same settings and package version when they run `npm install`. Keep `node_modules/` ignored. 

Note: The config is development tooling; exclude it and development dependencies from final production artifacts, while retaining them in any CI job that runs Debt Watcher.


## Commands
Commands can be used in conjunction to each other and are structured.

### Main commands

| Command | Purpose |
| --- | --- |
| `npx debt-watcher init` | Inspect and confirm team setup or repair |
| `npx debt-watcher init --dry-run` | Preview setup without changing files |
| `npx debt-watcher graveyard` | Generate the detailed code and branch report |
| `npx debt-watcher config` | Open the repository config in an editor |
| `npx debt-watcher --global config` | Open personal defaults in an editor |
| `npx debt-watcher --help` | see all available flags |

### Configuration commands

```sh
npx debt-watcher config --list
npx debt-watcher config --list markers
npx debt-watcher config --set fresh=45
npx debt-watcher config --set fresh=30 ageing=60 buried=90
npx debt-watcher config --add markers="TO DO,FIXME"
npx debt-watcher config --remove markers="HACK"
npx debt-watcher config --copy-from global
npx debt-watcher --global config --copy-from repo
```
Repository settings are read from the currently checked-out worktree for the whole report, even when scanning other branches. Use `--repo ../another-project` to target another local Git repository.

`--set` makes permanent changes to the selected config; `--add` and `--remove` currently work on markers. `--list` reads settings without changing them. Copying takes all supported settings from the other scope, not a live link. Use `--repo ../another-project` before a subcommand to target another local Git repository, including when copying from it.

### Report commands

```sh
npx debt-watcher graveyard
npx debt-watcher graveyard --group type
npx debt-watcher graveyard --group author
npx debt-watcher graveyard --group age
npx debt-watcher graveyard --summary
npx debt-watcher graveyard --summary blame
npx debt-watcher graveyard --filter type=branches
npx debt-watcher graveyard --filter type=code,branches
npx debt-watcher graveyard --filter author=Alex
npx debt-watcher graveyard --filter includefresh=true --order newold
```

Additional CLI options will let you temporarily override the configured freshness threshold and include fresh items in the report.

```sh
npx debt-watcher graveyard --remote --all
npx debt-watcher graveyard --filter includefresh=true
npx debt-watcher graveyard --fresh 45
npx debt-watcher graveyard --fresh 38 --ageing 65 --buried 70
```

`--group` changes the **detailed report's sections**; plain `graveyard` and `--group type` are equivalent. Author sections combine code and branch findings that share an email identity and show a count above their rows. Age sections follow `--order` and omit empty categories. `--summary` groups **counts** by debt type, while `--summary blame` groups them by author without detailed rows. Do not combine `--group` with `--summary`. `--filter` **selects findings** before either report. `type` accepts `code` and `branches` today; `issues` is reserved for future support. `author` matches author names or emails, and `includefresh` accepts `true` or `false`. Repeat `--filter` for different keys, such as `--filter type=code --filter author=Alex`.

`--fresh`, `--ageing`, `--buried`, `--markers`, and `--order` temporarily override settings for one run. The default `oldnew` order puts older findings first within the code and branch sections; `newold` reverses each section. `--remote` scans remote-tracking branches **already fetched locally** from all remotes; it does not fetch. The current implementation already scans every branch in its selected local or remote scope, so `--all` does not widen that scope. Selecting individual branches is not implemented yet.

The default report scans committed code comments and branch tips across local branches. `--remote` uses remote-tracking branches already fetched into your local repository; it does not fetch from the network. 

Fresh items are excluded by default. The initial config uses inclusive age limits of 30 days for fresh, 60 for ageing, and 90 for buried; older findings are fossil. 

Support for selecting specific branches is also planned. The corresponding flags are still to be defined.

### Saving reports & Compound commands
```sh
npx debt-watcher graveyard --save --output ./report.md
npx debt-watcher graveyard --summary --filter type=code --save --output ./code-summary.md
npx debt-watcher graveyard --summary blame --filter author=Alex --save
npx debt-watcher graveyard --save latest --output ./report-copy.md
```

### List of all commands
Run `npx debt-watcher --help` or a subcommand with `--help` for the complete option list.

## How it works
If you want to know how it works here is a little breakdown:

### How scanning works
We have our own parsing and extraction of comments but where possible we use the language's offical tools to tokenize and extract.

Debt Watcher extracts comments before matching configured markers, so marker-like text in strings is not treated as a comment. It uses these extractors:

| Source family | Extractor |
| --- | --- |
| JavaScript, TypeScript, JSX, TSX | Built-in comment scanner |
| Python | Python's standard-library `tokenize` when compatible; built-in fallback |
| Ruby | Ruby's `Ripper` when compatible; built-in fallback |
| Go | Go's standard-library `go/scanner` when compatible; built-in fallback |
| PHP and embedded HTML | PHP's `token_get_all()` when compatible; built-in fallback |
| C/C++, Rust, CSS, HTML, Django templates | Built-in comment scanners |

Official language tools are optional and must already be installed; Debt Watcher does not install them. Some valid but unsupported syntax is reported as **unscanned**, not silently counted as debt-free.

### High-Level System Flow

1. Identify the current Git repository and the branches in scope.
2. Read committed source files from those snapshots, extract real comments, and match configured markers.
3. Determine comment dates, commits, and authors from Git history. Internally, the tool uses `git blame` to collect these details.
4. Calculate ages, apply filters and ordering, and render the detailed report or requested summary.
5.  If requested, save Markdown or export the previous report snapshot.

Recognised GitHub and GitLab remotes provide web links to exact commits and lines. No GitHub/GitLab API authentication is needed for current code and branch scanning because it reads local Git data.

The tool will inspect `git remote get-url origin` to identify the repository's remote. Recognised GitHub and GitLab remotes will be used to generate web links alongside clickable terminal file links.

Issue provider support and authentication requirements are still to be defined.

### Example

The CLI uses aligned columns and section dividers. For example:

```text
🪦  PROJECT GRAVEYARD
Generated: 2026-10-05T16:44:51.643Z
Branches scanned: local/main, local/fix/webhook-retry
Group: type
Filters: includefresh=false
Order: oldnew

CODE DEBT                                      2
────────────────────────────────────────────────
🦖  1,204d  HACK   Temporary auth bypass  ·  main:src/auth.ts:18  ·  Ada
💀     42d  TODO   Handle malformed URLs   ·  main:src/url.ts:7    ·  Ben

STALE BRANCHES                                 1
────────────────────────────────────────────────
🪦   75d  fix/webhook-retry  ·  a13f0c2e47  ·  Ada

TOTAL : 3

CODE : 2  ·  BRANCHES : 1
AGES  🌱 0  💀 1  🪦 1  🦖 1

Oldest: CODE · 1,204d · HACK · Temporary auth bypass · main:src/auth.ts:18
```

The source location and abbreviated commit ID at the end of each row are clickable when a matching target is available. Their links use the full commit ID. Authors appear when `showAuthors` is enabled. Issue rows and their section will be added with issue scanning. Saved Markdown reports use tables and web links instead of the terminal layout.

The report will end with a debt summary containing:

- Total debt across the code and branch categories currently supported.
- The oldest item, including its debt type and details.
- Separate counts for code comments and stale branches.
- A randomly selected closing line based on the displayed findings, such as *“It's probably not temporary anymore.”* Saved reports and `--save latest` retain the line selected when the report was generated.

## Current scope

This release reports flagged code comments and stale branch tips. GitHub/GitLab issue scanning and `--filter type=issues` are planned, so the current CLI rejects that filter clearly. Reports identify files that could not be scanned rather than counting them as debt-free.

## License

Debt Watcher is licensed under the [BSD 3-Clause License](LICENSE). We welcome issues and pull requests in this repository; see [CONTRIBUTING.md](https://github.com/tsukuru-dev/project-debt-watcher/blob/main/CONTRIBUTING.md).
