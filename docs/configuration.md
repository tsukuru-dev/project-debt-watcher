# Configuration

The proposed shared filename is `debt-watcher.config.json`, stored at the target repository root and committed to Git. The checked-out branch's file governs the entire report, including scans of other branches.

`templates/debt-watcher.config.json` is a draft containing the agreed marker list, fresh-item inclusion, author display, ordering, and report directory. The default freshness threshold has not been specified in `Agent.md`; choose it and complete the configuration contract before treating this draft as a usable configuration. `reportDirectory` is the proposed key for the required export-directory setting.

Personal defaults live outside repositories in the user's configuration directory. They may be explicitly copied into a repository, but existing repository settings do not continuously inherit them. Runtime snapshots and declined-setup state are stored separately from configuration.

CLI overrides apply only to the current report. Permanent edits and copies must validate settings before writing. Configured relative report directories resolve against the repository root; relative `--output` paths resolve against the invocation's working directory.
