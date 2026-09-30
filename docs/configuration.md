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

Until setup and config editing are built, prepare a configuration manually by copying the supplied template to the selected path. No actual repository or personal configuration is created just by building the package.

## Personal defaults

Personal defaults use the same format and filename:

- Windows: `%APPDATA%/debt-watcher/debt-watcher.config.json`, with the user's `AppData/Roaming` directory as fallback.
- macOS: `~/Library/Application Support/debt-watcher/debt-watcher.config.json`.
- Linux and other Unix systems: `$XDG_CONFIG_HOME/debt-watcher/debt-watcher.config.json`, or `~/.config/debt-watcher/debt-watcher.config.json` when the environment value is absent or relative.

Listing an existing personal config needs no repository or Git executable. Personal defaults may later be explicitly copied into a repository; existing repository settings do not continuously inherit them. Personal first-use initialisation, configuration editing/copying, editor opening, and team setup remain future stages. Runtime snapshots and declined-setup state will be stored separately from configuration.

CLI overrides will apply only to the current report. Permanent edits and copies must validate settings before writing. Configured relative report directories resolve against the repository root; relative `--output` paths resolve against the invocation's working directory. Loading config does not require the report directory to exist; destination checks and creation prompts belong to saving reports.
