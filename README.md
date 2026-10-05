# Project Debt Watcher

Your friendly neighbourhood project debt watcher. Dig up forgotten TODOs, unresolved issues [coming soon], and stale branches before they become fossils.

Contents:
[Clickable link to each section]
1. What it does
2. Further Functionalities
3. Set up
4. Technical Specs
5. Commands
6. Current Scope

## What it does

Project Debt Watcher is a command-line tool for Git repositories. Its `graveyard` report will bring together different types of project debt:

- **Code comments:** unresolved markers such as `TODO`, `FIXME`, and `WORKAROUND`.
- **Issues:** unresolved repository issues, with links to their original discussions. [coming soon]
- **Stale branches:** branches that have not received a commit within a configurable period.

Reports will show items from oldest to newest, making it easier to spot work that has been left behind.

### Code comments
Debt Watcher finds ageing `TODO`, `FIXME`, and other configured markers in committed source comments.

These can be configured based on your needs using the config file.

### Stale branches
Debt watcher finds lost branches by looking at latest commit dates. It reports ages and authors without changing your checkout.

### Reporting and filters
The reporting in `graveyard` command is by default filtered by type (code, branches, issues) however can also be grouped by author or age.

Essentially commands exist that support the following:
- showing all items including fresh items
- grouping by type, age categories or authors
- filtered reports so you only see eg a specific author or specific age.

**Age categories:** these thresholds for ageing (💀), buried (🪦), and fossil (🦖) items. Age categories have been configured as defaults (these are editable in the config file).

## Further Functionality
This package is meant to be felxible to the user and allow for reporting as needed by the user with easy defaults in place.

### Age categories and how they work
Each setting is an inclusive maximum age: fresh is <= fresh, ageing is <= ageing, buried is <= buried; fossil is > buried. In this template that means:
conig file `fresh: 30` which means `fresh` are anything with ages 0-30 days, 
conig file `ageing: 60` which means `ageing` are anything with ages 31-60 days, 
conig file `buried: 90` which means `buried` are anything with ages 61-90 days
conig file does not include fossil in thresholds as which means `fossil` is assigned to anything older than the buried max threshold e.g older than 91+ days.

A freshness threshold supplied through the CLI will temporarily override the configured thresholds for that run and use the automatic three-band calculation. It will leave the saved configuration unchanged.

Unless you are setting it in config through command.

### Links
In terminal reports, a code location opens the local file when its bytes match the scanned commit. VS Code terminal links go to the flagged line; other terminals use the operating system's file handler, whose editor and line behavior can vary. If the local file differs, a recognised GitHub or GitLab remote supplies a link to the exact committed line instead. Branch commit IDs link to their commit pages. Saved Markdown uses portable web links where available. If a commit has not been pushed, its web link may not resolve yet.

### Saving Reports
Any report can be saved with `--save` added to the command.
If you generate a report and want to save that report that can be done by using save latest.
Functionality is also added to save the report in a location of your choosing by adding the folder location.

## Set up
For a shared team setup, run the CLI in an interactive terminal from your repository:
```sh
npx debt-watcher init
```

`init` shows the proposed changes and asks before applying them. It creates or reuses the repository's `debt-watcher.config.json`, adds Debt Watcher as an exact development dependency, and adds a `debt-watcher` npm script. In a non-Node repository, it creates the `package.json` needed for that team installation. It opens the config in your selected editor after setup. To inspect the proposed changes without applying them, use `npx debt-watcher init --dry-run`.

`debt-watcher.config.json` is required for scanning. An interactive first report can offer the same confirmed team setup as `init` if setup is missing. Non-interactive use and CI require a valid config and installed tooling; they do not prompt or install anything.

After team setup, the repository also has an npm script. Use `npm run debt-watcher -- graveyard` if you prefer it to `npx debt-watcher graveyard`; the `--` passes arguments through npm to the executable.

### Installation
You can also install first with `npm install --save-dev debt-watcher`, or install globally with `npm install -g debt-watcher`. Installation alone does not set up a repository; use `debt-watcher init` (or `npx debt-watcher init`) there. A global installation uses the same repository config, and can also keep personal defaults that seed new team setups. `npx` uses a local installation when available.

[shouldnt we also add in that it does repair and asks re personal prefered config or whatever and how all the personal config vs team config vs preference to use personal configs etc work]

### Configuration
A supplied configuration template contains editable defaults for:

- **Comment markers:** which unresolved code comments to include.
- **Freshness threshold:** the number of days used to filter ageing debt.
- **Age categories:** thresholds for ageing (💀), buried (🪦), and fossil (🦖) items.

A freshness threshold supplied through the CLI will temporarily override the configured thresholds for that run and use the automatic three-band calculation. It will leave the saved configuration unchanged. (Unless using the `set` command with `config`)

Current defaults are as follows:
```sh
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
  "reportDirectory": "./debt-watcher-reports",
```

## Technical Specs
The package supports multiple languages. Can be used using npx [does the npx still require node and npm installed?]

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

### Core commands
There are three core commands

```sh
npx debt-watcher init
```
```sh
npx debt-watcher graveyard
```
```sh
npx debt-watcher config
```

### Config commands

```sh
npx debt-watcher config --list
npx debt-watcher config --list markers
npx debt-watcher config --set fresh=45
npx debt-watcher config --add markers="TO DO,FIXME"
npx debt-watcher config --remove markers="HACK"
npx debt-watcher config
```
`config` with no action opens the repository config in an editor. Repository settings are read from the currently checked-out worktree for the whole report, even when scanning other branches. Use `--repo ../another-project` to target another local Git repository. Use `--global config` for personal defaults; those do not override an existing repository config. Run `debt-watcher --help` or a subcommand with `--help` for all available flags.

### Report commands

```sh
npx debt-watcher graveyard
npx debt-watcher graveyard --summary
npx debt-watcher graveyard --summary blame
npx debt-watcher graveyard --filter type=branches
npx debt-watcher graveyard --filter type=author
npx debt-watcher graveyard --filter includefresh=true --order newold
```

`--summary` counts by debt type and `--summary blame` groups by author. Filters, ordering, and age flags override config for one run only. `--save` generates and saves a new report; `--save latest` exports the last generated report without rescanning.

Additional CLI options will let you temporarily override the configured freshness threshold and include fresh items in the report.

[provide example command]

[need to change it so `filter` is different to `group` by?? or if we are keeping it all under `filter` then we explain here that filter and display is all in one and `type` should maybe be group or smth and the rest of it is filter age= or ]


```sh
npx debt-watcher graveyard --remote --all
```

The default report scans committed code comments and branch tips across local branches. `--remote` uses remote-tracking branches already fetched into your local repository; it does not fetch from the network. 

```sh
npx debt-watcher graveyard --filter includefresh=true
npx [command for temporarily changing age thresholds]
```

Fresh items are excluded by default. The initial config uses inclusive age limits of 30 days for fresh, 60 for ageing, and 90 for buried; older findings are fossil. 

Support for selecting specific branches is also planned. The corresponding flags are still to be defined.

### Saving reports commands
```sh
npx debt-watcher graveyard --save --output ./report.md
npx debt-watcher graveyard --save latest --output ./report-copy.md
```

### Compounded Commands

[Provide examples and explain how it works in general]

### List of all commands
[Table of all commands]

## How it works
If you want to know how it works here is a little breakdown:

### How scanning works
We have our own parsing and extraction of comments but where possible we use the language's offical tools to tokenize and extract.

[Add table for each language and what we chose to do]

Broadly, however, the process does the following:

1. Identify the current Git repository and the branches in scope.
2. Scan source files for configured comment markers.
3. Determine comment dates, commits, and authors from Git history. Internally, the tool uses `git blame` to collect these details.
4. Collect unresolved issues and identify stale branches using their latest commits.
5. Calculate item ages, sort from oldest to newest, and print the graveyard report.

The tool will inspect `git remote get-url origin` to identify the repository's remote. Recognised GitHub and GitLab remotes will be used to generate web links alongside clickable terminal file links.

Issue provider support and authentication requirements are still to be defined.

### Example

The report follows the following format:

Each section will display its item count on the right, with an age indicator on each row.

| Section | Row contents |
| --- | --- |
| Code | Age emoji, days old, linked comment marker, comment text, author when requested |
| Issues | Age emoji, days old, linked issue ID, issue title, author |
| Stale branches | Age emoji, days since the last commit, linked commit ID, branch name, last commit author |

The report will end with a debt summary containing:

- Total debt across all three categories.
- The oldest item, including its debt type and details.
- Separate counts for code comments, issues, and stale branches.
- A randomly selected closing line, potentially based on the age or volume of debt: *“It's probably not temporary anymore.”*

## Current scope

This release reports flagged code comments and stale branch tips. GitHub/GitLab issue scanning and `--filter type=issues` are planned, so the current CLI rejects that filter clearly. Reports identify files that could not be scanned rather than counting them as debt-free.