# Configuration

The shared filename is `debt-watcher.config.json`, stored at the target Git worktree root and committed to Git. The checked-out branch's saved working-tree file governs the entire report, including scans of other branches. Configuration is read again on each invocation, so uncommitted edits and branch changes take effect immediately.

The supplied `templates/debt-watcher.config.json` is a valid starting configuration. Its initial freshness threshold is **30 days** and can be customised for each project. Existing files keep their saved threshold; loading does not merge in template or personal defaults.

| Setting | Required value / initial template |
| --- | --- |
| `fresh` | Non-negative whole days; initially `30` |
| `markers` | Array of marker strings; initially TODO, FIXME, HACK, DEPRECATED, TEMP, WORKAROUND |
| `includeFresh` | Boolean; initially `false` |
| `showAuthors` | Boolean; initially `true` |
| `order` | `oldnew` or `newold`; initially `oldnew` |
| `reportDirectory` | Non-empty path string; initially `./debt-watcher-reports` |
| `ageing`, `buried`, `fossil` | Omit all three for automatic bands, or provide all three as strictly increasing non-negative whole-day thresholds |

`fresh` controls inclusion independently of the custom age bands. Defining any custom band requires the full set, with `ageing < buried < fossil`. Age calculation and report filtering will be implemented with reporting.

Marker entries must be non-empty strings with no surrounding whitespace, duplicates, or language comment delimiters. Spaces inside a marker, such as `TO DO`, are supported. An empty array means no configured code markers. Literal commas can be represented in a JSON marker string, but the CLI comma-separated list syntax cannot express them.

Unknown configuration keys are rejected. Optional `$schema` (a string) and `metadata` (an object for team notes) are retained alongside settings; they are not scanning settings. A `$schema` value is preserved as metadata without fetching anything. The loader accepts a UTF-8 BOM and otherwise requires valid JSON.

## Reading saved settings

```sh
debt-watcher config --list
debt-watcher config --list markers
debt-watcher config --list fresh
debt-watcher config --list --repo "../another-project"
debt-watcher --global config --list
```

Each listing prints the selected file's absolute path. Listing is read-only: it does not change settings, create files or directories, open editors, or run team setup. Run from a repository subfolder or use `--repo` relative to the invocation's working directory; the loader locates that worktree's root rather than searching ancestor configuration files. Linked worktrees use their own config.

Missing files, invalid JSON, invalid settings, and file-access errors fail with the selected path and a clear explanation. Missing repository configuration never falls back to another branch or personal defaults. Saved values must provide all required settings.

Until team setup is built, prepare a repository configuration manually from the supplied template, or explicitly copy existing personal settings as described below. No actual repository or personal configuration is created just by building the package.

## Editing saved settings

Choose one action per invocation:

```sh
debt-watcher config --set fresh=60
debt-watcher config --set includeFresh=true showAuthors=false order=newold
debt-watcher config --set fresh=30 ageing=60 buried=120 fossil=365
debt-watcher config --set markers="TODO,FIXME"
debt-watcher config --add markers="TO DO,FIXME"
debt-watcher config --remove markers="HACK"
debt-watcher config --set reportDirectory="./team reports"
debt-watcher config --set fresh=45 --repo "../another-project"
debt-watcher --global config --set fresh=60
```

`--set` replaces the named settings. Multiple assignments are merged and validated together before writing; an invalid result leaves the file unchanged. Setting `fresh` without an explicit `ageing`, `buried`, or `fossil` assignment removes saved custom bands and selects automatic bands. Explicit band assignments merge with saved bands and must produce a complete, ascending set.

`--add` and `--remove` operate only on markers. Add appends missing markers, retaining the existing order; remove leaves all other markers alone. Marker matching is exact and case-sensitive. Quote a comma-separated value as one argument; surrounding whitespace is trimmed and internal spaces are kept. Removing all configured markers leaves an empty array.

Every edit displays its target path and result. Adding existing markers, removing absent markers, or setting already-saved values reports no changes and leaves the file untouched. Successful edits preserve unrelated settings, `$schema`, and `metadata`, along with existing indentation, line endings, and a UTF-8 BOM. The complete document is written to a temporary file before replacing the original; a detected intervening edit fails with instructions to rerun. Read-only files and symbolic-link destinations cannot be edited through the CLI.

Repository setting edits require an existing, valid config at the selected worktree root. Invalid existing files must be corrected in an editor before using setting actions or copies. Edits change only the working-tree file; they do not stage or commit it. Setting `reportDirectory` saves the path without creating or validating that destination directory; those checks belong to report saving.

## Copying settings

```sh
debt-watcher --global config --copy-from repo
debt-watcher --global config --copy-from repo --repo "../source-project"
debt-watcher config --copy-from global
debt-watcher config --copy-from global --repo "../destination-project"
```

Copying validates the source first, shows both paths, and replaces all supported settings, including marker lists and custom age bands. The destination keeps its own `$schema` and `metadata`; source metadata never crosses scopes. Relative report-directory paths stay relative. Absolute paths produce a notice that they may be specific to this machine. Copies never create report directories.

Replacing different existing settings requires confirmation in an interactive terminal; an empty answer, cancellation, or anything other than `y`/`yes` declines. CI and non-interactive use fail when confirmation is required. Matching settings report no changes without prompting or rewriting the file. A missing destination may be created by the explicit copy action, including a repository config; this does not perform team setup.

Missing or invalid sources are errors and are never manufactured from defaults. Invalid destinations are preserved for manual correction. Changes detected in the destination while awaiting confirmation cause the save to fail. Copies do not install dependencies, modify package files, stage changes, or commit them. Existing repository settings never continuously inherit personal settings.

## Opening in an editor

```sh
debt-watcher config
debt-watcher config --repo "../another-project"
debt-watcher --global config
```

With no action, `config` opens the selected file in an interactive terminal. Repository opening requires an existing file. Personal opening creates a missing file from the supplied template. Existing files are preserved; invalid JSON or settings are reported and opened for manual repair.

Editors are selected in this order:

1. `VISUAL`, then `EDITOR`, when configured. A failed explicit preference is reported so the user can correct it.
2. The current supported editor, when its installation can be identified from the terminal's `VSCODE_GIT_ASKPASS_MAIN` path. The generic `TERM_PROGRAM=vscode` marker alone is ambiguous because editor forks share it.
3. Installed VS Code, Cursor, then Antigravity. Discovery checks executable locations on PATH, Windows user/system installations, and macOS system/user Applications folders. Windows discovery uses native executables rather than batch wrappers. Custom installations outside these locations may need an explicit preference.
4. The system file association: Windows' default `.json` app, macOS `open`, or Linux `xdg-open`. If that fails, use Notepad on Windows, the system text editor on macOS, or `vi` on Linux.

An automatically selected editor that cannot launch is skipped in favour of the next candidate. Detection does not install editors or change file associations. Some GUI launchers return before editing finishes, so save your edits before running another command.

Environment values can contain an executable and arguments, such as `code --wait` on systems where `code` is directly executable. Quote executable paths containing spaces. Commands are launched without shell expansion; shell aliases, variables and command substitution are not evaluated. On Windows, configure the editor's `.exe` rather than a `.cmd`/`.bat` wrapper.

The CLI displays the full config path. If launching the editor fails, it returns an error with that path for manual opening and keeps the file. CI and non-interactive invocations do not launch editors or create defaults through the opening action; they report the selected path instead. Listing and other configuration actions never launch an editor.

## Personal defaults

Personal defaults use the same format and filename:

- Windows: `%APPDATA%/debt-watcher/debt-watcher.config.json`, with the user's `AppData/Roaming` directory as fallback.
- macOS: `~/Library/Application Support/debt-watcher/debt-watcher.config.json`.
- Linux and other Unix systems: `$XDG_CONFIG_HOME/debt-watcher/debt-watcher.config.json`, or `~/.config/debt-watcher/debt-watcher.config.json` when the environment value is absent or relative.

Personal configuration actions need no repository or Git executable except when copying from a repository. An explicit `--global config --set`, `--add`, or `--remove` creates missing personal defaults from the supplied template after validating the complete requested change. Interactive `--global config` also initialises them before opening. Listing remains read-only and does not initialise missing defaults. Invalid existing personal files are preserved and reported.

General first-run setup, detecting global installations for automatic personal initialisation, and team setup remain future stages. Runtime snapshots and declined-setup state will be stored separately from configuration.

CLI overrides will apply only to the current report. Permanent edits and copies must validate settings before writing. Configured relative report directories resolve against the repository root; relative `--output` paths resolve against the invocation's working directory. Loading config does not require the report directory to exist; destination checks and creation prompts belong to saving reports.
