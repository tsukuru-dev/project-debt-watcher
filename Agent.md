# to-do-graveyard
Your friendly neighbourhood Project debt watcher

## What it does

### Commands

SUMMARY ONLY NOT DETAILED TABLE
> npx debt-watcher summary

After project setup with `npx debt-watcher init`, the shortcut is `npm run debt-summary`.

GRAVEYARD LIST (ALL BRANCHES ON LOCAL)
> npx debt-watcher graveyard

FOR GRAVEYARD LIST WITH AUTHORS
> npx debt-watcher graveyard --blame
gives you the full list of graveyard uses `git blame`

GRAVEYARD LIST ALL BRANCHES ON REMOTE
> npx debt-watcher graveyard --remote --all


### How the system works

the system does the following:

looks at current GitHub repo -> scans source files -> finds comments in code -> git blame each of them -> get Author date and commit -> calculate age -> list oldest to newest -> print pretty CLI

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

The CLI should override any presets in the config temporarily this will then use the /3 rule

If user wants fresh items to also appear then we will need a command for that too

## Saving reports

Users must be able to generate a report and then save that same report with a separate command:

```sh
npx debt-watcher graveyard --blame
npx debt-watcher save
```

Support an optional output path:

```sh
npx debt-watcher save ./reports/debt-report.md
```

- Save the last successfully generated `graveyard` or `summary` report for the current repository without rescanning. Preserve its original generation time, scope, filters, age values, author visibility, and closing line.
- Retain the latest report snapshot per repository in a user-level cache outside the repository so it survives separate CLI invocations, including `npx`. Local, global, and `npx` usage must share this behaviour. Do not store snapshots in shared configuration or Git.
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
- If no saved snapshot exists for the current repository, explain that the user must generate a report first. Never export another repository's report or silently generate a replacement.
- Exported reports are user-requested files; saving must not automatically stage, commit, or change Git ignore rules for them.

## Compatibility
It should work for the following languages: Python, JS, TS, Node, React, CSS, C++, Rust, Go, Django

The markers should just be text and not include the // because we should be able to understand what the comment symbols will be based on the languages

It should not be that we are scanning the whole repo etc for the text in markers list but rather specifically comment/ comment syntax which means that our system should recognise what syntax is required for each language

## The build

Build one npm package that supports both running through `npx` and installation as a project development dependency. The setup and distribution requirements are defined below.

The first thing we will build will be the code check
then we will do the branches
we will do issues last so lets put a pin in that for now

## Build and distribution requirements

- Build one npm CLI package using TypeScript and Node.js.
- Publish compiled JavaScript so users do not need to build the tool.
- Expose the `debt-watcher` executable.
- Users require Node.js/npm and Git.

### Run without adding a project dependency

Support:
- `npx debt-watcher graveyard`
- `npx debt-watcher graveyard --blame`
- `npx debt-watcher summary`

This usage must work in Git repositories without a package.json.
Every repository must have a Debt Watcher configuration file before scanning, including when using `npx`. If it is missing during an interactive run, offer to create it from the default template simple y/n that as it is needed to do scan. If setup is declined, cancel the scan. Non-interactive and CI runs must report missing configuration with setup instructions instead of silently using defaults.
`npx` uses the locally installed package when available; otherwise it can obtain the package through npm's cache. It does not necessarily download the package on every run.

### Install in a project

Support installation with:
`npm install --save-dev debt-watcher`

After installation, the same npx commands must run the local version.

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

### Project setup with init

Provide an explicit setup command:

```sh
npm install --save-dev debt-watcher
npx debt-watcher init
```

The `init` command must:

- Create the editable default configuration file when one does not exist.
- Add the following npm scripts when a `package.json` exists in the project being configured.
- Preserve unrelated package.json fields and existing scripts and configuration.
- Ask before replacing conflicting scripts or existing configuration; without confirmation, preserve them. In non-interactive use, report conflicts without overwriting them.
- Be safe to run repeatedly, leaving matching scripts and existing settings unchanged.
- When no `package.json` exists, create only the configuration file and explain that npm script shortcuts were not added. Do not create a package.json just to scan a non-Node project.

```json
{
  "scripts": {
    "graveyard": "debt-watcher graveyard",
    "debt-summary": "debt-watcher summary"
  }
}
```

Run them with:

- `npm run graveyard`
- `npm run debt-summary`

Installing the tool must not automatically modify the project's scripts or create its configuration. Those changes belong to the explicit `init` command. Users may also add the scripts manually.

### Development and release

Provide commands to build and test the tool locally.
Verify the packaged CLI before publishing to npm.
