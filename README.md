# to-do-graveyard
Your friendly neighbourhood Project debt watcher

## What it does

### Commands

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

Amount of days as filter and unresolved code comments can be modified and editted/stipulated/set up

Emoji is dictated by oldest graveyard item - stipulated length/3
each third then gets its own emoji demarking it as low medium high
or the user can set up low medium high themselves if they want to be specific and not just set the amount of days filter

So user can either set just the fresh threshold or they can be more specific and set the ageing(RIP emoji) buried (gravestone emoji) and fossil (dinosaur emoji) thresholds

