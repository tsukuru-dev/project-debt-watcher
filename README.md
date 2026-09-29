# Project Debt Watcher

Your friendly neighbourhood project debt watcher. Dig up forgotten TODOs, unresolved issues, and stale branches before they become fossils.

> **Status: planning.** This repository currently documents the project concept. The commands and features below describe the intended interface; an installable CLI is not yet included.

## What it does

Project Debt Watcher is a planned command-line tool for Git repositories. Its `graveyard` report will bring together three types of project debt:

- **Code comments:** unresolved markers such as `TODO`, `FIXME`, and `WORKAROUND`.
- **Issues:** unresolved repository issues, with links to their original discussions.
- **Stale branches:** branches that have not received a commit within a configurable period.

Reports will show items from oldest to newest, making it easier to spot work that has been left behind.

## Planned commands

Run these commands from inside the Git repository you want to inspect once the CLI is available.

### Inspect all local branches

```sh
npx debt-watcher graveyard
```

All local branches will be included by default.

### Include code comment authors

```sh
npx debt-watcher graveyard --blame
```

Include authorship details alongside flagged code comments in the report.

### Inspect all remote branches

```sh
npx debt-watcher graveyard --remote --all
```

Support for selecting specific branches is also planned. The corresponding flags are still to be defined.

Additional CLI options will let you temporarily override the configured freshness threshold and include fresh items in the report. Their flag names are still to be defined.

## How scanning will work

1. Identify the current Git repository and the branches in scope.
2. Scan source files for configured comment markers.
3. Determine comment dates, commits, and authors from Git history. Internally, the tool uses `git blame` to collect these details.
4. Collect unresolved issues and identify stale branches using their latest commits.
5. Calculate item ages, sort from oldest to newest, and print the graveyard report.

The tool will inspect `git remote get-url origin` to identify the repository's remote. Recognised GitHub and GitLab remotes will be used to generate web links alongside clickable terminal file links.

Issue provider support and authentication requirements are still to be defined.

## The graveyard report

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

### Default comment markers

The planned defaults will flag comments containing these markers:

```text
// TODO:
// FIXME:
// HACK:
// DEPRECATED:
// TEMP:
// WORKAROUND:
```

These examples use `//` comments. Supported source languages and comment syntax are still to be defined.

## Planned configuration

A supplied configuration template will contain editable defaults for:

- **Comment markers:** which unresolved code comments to include.
- **Freshness threshold:** the number of days used to filter ageing debt.
- **Age categories:** thresholds for ageing (💀), buried (🪦), and fossil (🦖) items.

By default, the configuration will set a single freshness threshold. Fresh items will be excluded unless you request them through the CLI. The age range from the freshness threshold to the oldest graveyard item will be divided into three equal bands: ageing, buried, and fossil.

For more control, you will be able to set explicit thresholds for each age category in the configuration file.

A freshness threshold supplied through the CLI will temporarily override the configured thresholds for that run and use the automatic three-band calculation. It will leave the saved configuration unchanged.

Default day values, configuration filename, schema, and handling of age-band boundaries are still to be finalised.

## Development status

Implementation, installation instructions, and development commands will be added as the CLI takes shape.
