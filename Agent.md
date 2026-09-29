# to-do-graveyard
Your friendly neighbourhood Project debt watcher

## What it does

### Commands

SUMMARY ONLY NOT DETAILED TABLE
> npx debt-watcher summary or npm debt-summary

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

## Compatibility
It should work for the following languages: Python, JS, TS, Node, React, CSS, C++, Rust, Go, Django

The markers should just be text and not include the // because we should be able to understand what the comment symbols will be based on the languages

It should not be that we are scanning the whole repo etc for the text in markers list but rather specifically comment/ comment syntax which means that our system should recognise what syntax is required for each language

## The build

This will be an npm package
We will build it using TypeScript & Node

It should work as both npx command and as an npm install. It should support both ways of using it.

npx debt-watcher graveyard
fetches the package and runs its CLI. Great for someone seeing GitHub and thinking “ooh, let's run this on my repo.”

then locally npx debt-watcher graveyard

or in package.json
{
  "scripts": {
    "graveyard": "debt-watcher graveyard"
  }
}

then it is as simple as npm run graveyard

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

### Install in a project

Support installation with:
`npm install --save-dev debt-watcher`

After installation, the same npx commands must run the local version.

### Optional npm scripts

Users may manually add these scripts to their project's package.json:

"scripts": {
  "graveyard": "debt-watcher graveyard",
  "debt-summary": "debt-watcher summary"
}

Run them with:
- `npm run graveyard`
- `npm run debt-summary`

Installing the tool must not automatically modify the project's scripts.

### Development and release

Provide commands to build and test the tool locally.
Verify the packaged CLI before publishing to npm.